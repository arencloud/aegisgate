package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"regexp"
	"strings"
	"testing"
	"text/template"

	"github.com/Masterminds/sprig/v3"
	"gopkg.in/yaml.v3"
)

func TestRealmSecretReferences(t *testing.T) {
	data, err := os.ReadFile("../../deploy/gitops/keycloak/base/realm-import.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var resource struct {
		Spec struct {
			Placeholders map[string]struct{ Secret struct{ Name, Key string } }
			Realm        map[string]any
		}
	}
	if err := yaml.Unmarshal(data, &resource); err != nil {
		t.Fatal(err)
	}
	secretKeys := templates(t, "keycloak-realm")
	// The operator uses the realm name as a Secret data key before substitution.
	realmName, ok := resource.Spec.Realm["realm"].(string)
	if !ok || !regexp.MustCompile(`^[A-Za-z0-9._-]+$`).MatchString(realmName+"-realm.json") {
		t.Fatal("realm name must produce a valid Secret filename before placeholder expansion")
	}
	if realmName != "aegisgate" {
		t.Fatal("realm name must match the realm validated by ESO")
	}
	encoded, err := json.Marshal(resource.Spec.Realm)
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range regexp.MustCompile(`\$\{([A-Z_]+)\}`).FindAllSubmatch(encoded, -1) {
		ref, exists := resource.Spec.Placeholders[string(match[1])]
		if !exists || ref.Secret.Name != "keycloak-realm" || secretKeys[ref.Secret.Key] == "" {
			t.Fatalf("unresolved realm placeholder %s", match[1])
		}
	}
	clients := resource.Spec.Realm["clients"].([]any)
	client := clients[0].(map[string]any)
	for _, flag := range []string{"publicClient", "directAccessGrantsEnabled", "serviceAccountsEnabled", "implicitFlowEnabled"} {
		if client[flag] != false {
			t.Errorf("insecure client flag %s", flag)
		}
	}
	if client["attributes"].(map[string]any)["pkce.code.challenge.method"] != "S256" {
		t.Fatal("PKCE missing")
	}
	if client["redirectUris"].([]any)[0] != "https://demo.aegisgate.example.com/auth/callback" {
		t.Fatal("unexpected callback")
	}
}

func templates(t *testing.T, name string) map[string]string {
	return templateFile(t, "../../deploy/gitops/keycloak/base/external-secrets.yaml", name)
}

func templateFile(t *testing.T, path, name string) map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	d := yaml.NewDecoder(f)
	for {
		var v struct {
			Metadata struct{ Name string }
			Spec     struct {
				Target struct {
					Template struct{ Data map[string]string }
				}
			}
		}
		if err := d.Decode(&v); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		if v.Metadata.Name == name {
			return v.Spec.Target.Template.Data
		}
	}
	t.Fatal("template not found")
	return nil
}

func render(source string, data map[string]string) (string, error) {
	// ESO's v2 engine excludes these Sprig functions. Using the unrestricted
	// map here hid production template parse failures after an ESO update.
	funcs := sprig.TxtFuncMap()
	for _, name := range []string{"env", "expandenv", "getHostByName", "fail"} {
		delete(funcs, name)
	}
	tmpl, err := template.New("eso").Funcs(funcs).Option("missingkey=error").Parse(source)
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	err = tmpl.Execute(&out, data)
	return out.String(), err
}

func TestDatabaseTLS(t *testing.T) {
	tmpl := templates(t, "keycloak-db")["jdbc-url"]
	data := map[string]string{"host": "pgsql.example.test", "port": "5432", "database": "aegisgatedb", "sslmode": "verify-full"}
	out, err := render(tmpl, data)
	if err != nil || !strings.Contains(out, "?sslmode=verify-full&sslrootcert=/opt/keycloak/conf/truststores/secret-keycloak-db-ca/root.pem") {
		t.Fatalf("invalid JDBC render: %v", err)
	}
	for _, mode := range []string{"disable", "require", "verify-ca"} {
		data["sslmode"] = mode
		if _, err := render(tmpl, data); err == nil {
			t.Fatalf("accepted TLS downgrade %s", mode)
		}
	}
	data["sslmode"] = "verify-full"
	data["host"] = "db.test/?sslmode=disable"
	if _, err := render(tmpl, data); err == nil {
		t.Fatal("accepted URL injection")
	}
}

func TestValidationErrorsDoNotExposeValues(t *testing.T) {
	// Validation must stop reconciliation, but its diagnostic must contain only
	// a static label, never the input value or another credential in the record.
	sensitive := "synthetic-private-value-not-for-error-output"
	cases := []struct {
		source string
		data   map[string]string
	}{
		{templates(t, "keycloak-bootstrap")["username"], map[string]string{"realm": sensitive, "username": sensitive, "password": sensitive}},
		{templates(t, "keycloak-db")["jdbc-url"], map[string]string{"sslmode": sensitive, "password": sensitive}},
		{templateFile(t, "../../deploy/gitops/redis/base/external-secret.yaml", "redis-auth")["password"], map[string]string{"username": sensitive, "password": sensitive}},
		{templateFile(t, "../../deploy/gitops/application/base/external-secrets.yaml", "session-manager-oidc")["config.json"], map[string]string{"realm": sensitive, "client_secret": sensitive}},
	}
	for _, tc := range cases {
		_, err := render(tc.source, tc.data)
		if err == nil {
			t.Fatal("invalid configuration was accepted")
		}
		if !strings.Contains(err.Error(), "aegisgate validation:") || strings.Contains(err.Error(), sensitive) {
			t.Fatal("validation diagnostic must have a static label and no input values")
		}
	}
}

func TestBootstrapRealm(t *testing.T) {
	tmpl := templates(t, "keycloak-bootstrap")["username"]
	for _, realm := range []string{"master", "aegisgate"} {
		_, err := render(tmpl, map[string]string{"realm": realm, "username": "bootstrap-admin"})
		if (realm == "master") != (err == nil) {
			t.Fatalf("incorrect bootstrap validation for %s", realm)
		}
	}
}

func TestUserSecretsAndValidation(t *testing.T) {
	tmpl := templates(t, "keycloak-realm")
	data := map[string]string{"client": `{"realm":"aegisgate","client_id":"aegisgate","client_secret":"fixture-only"}`}
	weird := "fixture-quote\"-backslash\\-newline\n"
	for _, name := range []string{"admin", "operator", "viewer"} {
		user := map[string]any{"realm": "aegisgate", "role": "aegis-" + name, "username": name, "password": weird, "temporary": false}
		raw, _ := json.Marshal(user)
		data[name] = string(raw)
	}
	for key, source := range tmpl {
		out, err := render(source, data)
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		if strings.HasSuffix(key, "_password") && out != weird {
			t.Fatal("password changed during rendering")
		}
	}
	for _, bad := range []string{
		`{"realm":"wrong","role":"aegis-admin","username":"admin","password":"fixture","temporary":false}`,
		`{"realm":"aegisgate","role":"aegis-viewer","username":"admin","password":"fixture","temporary":false}`,
		`{"realm":"aegisgate","role":"aegis-admin","username":"admin","password":"fixture","temporary":"false"}`,
		`{"realm":"aegisgate","role":"aegis-admin","username":"admin","password":"fixture","temporary":true}`,
		`{"realm":"aegisgate","role":"aegis-admin","username":"admin","temporary":false}`,
	} {
		data["admin"] = bad
		if _, err := render(tmpl["admin_password"], data); err == nil {
			t.Fatal("invalid user record accepted")
		}
	}
}
