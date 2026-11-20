package main

import (
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestApplicationSecrets(t *testing.T) {
	path := "../../deploy/gitops/application/base/external-secrets.yaml"
	oidc := templateFile(t, path, "session-manager-oidc")
	fixture := map[string]string{"realm": "aegisgate", "client_id": "client-\"quote\\slash", "client_secret": "fixture-only-secret"}
	config, err := render(oidc["config.json"], fixture)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Providers []struct {
			Issuer   string
			ClientID string `json:"client_id"`
		}
		Rules []struct {
			Method, Path string
			Roles        []string
		}
	}
	if err := json.Unmarshal([]byte(config), &parsed); err != nil {
		t.Fatal(err)
	}
	if len(parsed.Providers) != 1 || parsed.Providers[0].ClientID != fixture["client_id"] || parsed.Providers[0].Issuer != "https://auth.aegisgate.example.com/realms/aegisgate" {
		t.Fatal("OIDC config was not safely rendered")
	}
	if strings.Contains(config, fixture["client_secret"]) {
		t.Fatal("client secret must be supplied through its env Secret key")
	}
	for _, r := range parsed.Rules {
		if r.Method == "POST" {
			for _, role := range r.Roles {
				if role == "viewer" {
					t.Fatal("viewer may not write")
				}
			}
		}
	}
	fixture["realm"] = "other"
	if _, err := render(oidc["config.json"], fixture); err == nil {
		t.Fatal("mismatched realm accepted")
	}
	fixture["client_secret"] = ""
	if _, err := render(oidc["KEYCLOAK_CLIENT_SECRET"], fixture); err == nil {
		t.Fatal("empty client secret accepted")
	}
	token := templateFile(t, path, "backend-token")["BACKEND_TOKEN"]
	for _, bad := range []string{"", "short"} {
		if _, err := render(token, map[string]string{"token": bad}); err == nil {
			t.Fatal("weak internal token accepted")
		}
	}
}

func TestApplicationRouteBoundaries(t *testing.T) {
	out, err := exec.Command("kubectl", "kustomize", "../../deploy/gitops/application/overlays/example").CombinedOutput()
	if err != nil {
		t.Fatalf("render failed: %s", out)
	}
	// Decode the actual overlay so resource inclusion and patches are covered.
	dec := yaml.NewDecoder(strings.NewReader(string(out)))
	routes := map[string]map[string]any{}
	for {
		var r map[string]any
		if err := dec.Decode(&r); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		kind := r["kind"].(string)
		switch kind {
		case "Secret", "Namespace", "Redkey", "Keycloak":
			t.Errorf("unexpected ownership or inline credentials: %s", kind)
		case "HTTPRoute":
			name := r["metadata"].(map[string]any)["name"].(string)
			routes[name] = r["spec"].(map[string]any)
		}
	}
	if len(routes) != 3 {
		t.Fatalf("expected 3 public route resources, got %d", len(routes))
	}
	for name, r := range routes {
		for _, rule := range r["rules"].([]any) {
			refs := rule.(map[string]any)["backendRefs"].([]any)
			for _, ref := range refs {
				backend := ref.(map[string]any)["name"]
				if name == "webui" && backend != "webui" {
					t.Fatal("UI route has wrong backend")
				}
				if name != "webui" && backend != "session-manager" {
					t.Fatal("public API/auth bypasses session manager")
				}
			}
		}
	}
	nginx, err := os.ReadFile("../../deploy/gitops/application/base/nginx.conf")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(nginx), "proxy_pass") {
		t.Fatal("UI must not provide a second API/auth proxy path")
	}
	auth, err := os.ReadFile("../../deploy/gitops/application/base/authpolicy.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var policy struct {
		Spec struct {
			TargetRef struct{ Kind, Name string } `yaml:"targetRef"`
			Rules     map[string]any
		}
	}
	if err := yaml.Unmarshal(auth, &policy); err != nil {
		t.Fatal(err)
	}
	if policy.Spec.TargetRef.Kind != "HTTPRoute" || policy.Spec.TargetRef.Name != "application-api" {
		t.Fatal("session auth policy must not gate login or Keycloak")
	}
	if policy.Spec.Rules["metadata"] == nil || policy.Spec.Rules["authorization"] == nil {
		t.Fatal("session metadata authorization is required")
	}
}

func TestNorthPrivateCheckAndGatewayReadiness(t *testing.T) {
	for _, component := range []string{"gateway", "application"} {
		out, err := exec.Command("kubectl", "kustomize", "../../deploy/gitops/"+component+"/overlays/example").CombinedOutput()
		if err != nil {
			t.Fatalf("render %s: %s", component, out)
		}
		dec := yaml.NewDecoder(strings.NewReader(string(out)))
		found := false
		for {
			var r map[string]any
			if err := dec.Decode(&r); err == io.EOF {
				break
			} else if err != nil {
				t.Fatal(err)
			}
			name := r["metadata"].(map[string]any)["name"]
			spec, _ := r["spec"].(map[string]any)
			if r["kind"] == "HTTPRoute" {
				for _, rule := range spec["rules"].([]any) {
					for _, ref := range rule.(map[string]any)["backendRefs"].([]any) {
						if ref.(map[string]any)["name"] == "session-check" {
							t.Fatal("private session checks exposed through a public route")
						}
					}
				}
			}
			if component == "gateway" && r["kind"] == "HTTPRoute" && name == "aegisgate-gateway-readiness" {
				found = true
				if len(spec["parentRefs"].([]any)) != 2 {
					t.Fatal("readiness must attach to both HTTPS listeners")
				}
				rule := spec["rules"].([]any)[0].(map[string]any)
				path := rule["matches"].([]any)[0].(map[string]any)["path"].(map[string]any)
				if path["type"] != "Exact" || path["value"] != "/health/ready" {
					t.Fatal("readiness match is too broad")
				}
				rewrite := rule["filters"].([]any)[0].(map[string]any)["urlRewrite"].(map[string]any)["path"].(map[string]any)
				if rewrite["replaceFullPath"] != "/healthz/ready" {
					t.Fatal("not Envoy native readiness")
				}
				ref := rule["backendRefs"].([]any)[0].(map[string]any)
				if ref["name"] != "aegisgate-gateway-readiness" || ref["port"] != 15021 {
					t.Fatal("readiness routes to an application instead of Envoy")
				}
			}
			if component == "application" && r["kind"] == "AuthorizationPolicy" && name == "session-manager-transport" {
				found = true
				rules := spec["rules"].([]any)
				if len(rules) != 2 {
					t.Fatal("unexpected session manager transport access")
				}
				for i, expected := range []struct{ principal, port string }{
					{"mesh.example.com/ns/aegisgate/sa/session-manager-waypoint", "8081"},
					{"mesh.example.com/ns/kuadrant-system/sa/authorino-authorino", "8082"},
				} {
					rule := rules[i].(map[string]any)
					principals := rule["from"].([]any)[0].(map[string]any)["source"].(map[string]any)["principals"].([]any)
					ports := rule["to"].([]any)[0].(map[string]any)["operation"].(map[string]any)["ports"].([]any)
					if len(principals) != 1 || principals[0] != expected.principal || len(ports) != 1 || ports[0] != expected.port {
						t.Fatal("Authorino check access must not permit public listener/waypoint bypass")
					}
				}
			}
		}
		if !found {
			t.Fatalf("missing %s security/readiness resource", component)
		}
	}
}
