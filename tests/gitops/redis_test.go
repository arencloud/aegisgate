package main

import "testing"

func TestRedisVaultContract(t *testing.T) {
	cases := []struct{ path, name, key string }{
		{"../../deploy/gitops/redis/base/external-secret.yaml", "redis-auth", "password"},
		{"../../deploy/gitops/redis/client/external-secret.yaml", "session-manager-redis", "REDIS_URL"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source := templateFile(t, tc.path, tc.name)[tc.key]
			fixture := map[string]string{"username": "default", "database": "0", "port": "6379", "password": "fixture_only-Abc123"}
			value, err := render(source, fixture)
			if err != nil {
				t.Fatal(err)
			}
			expected := fixture["password"]
			if tc.key == "REDIS_URL" {
				expected = "redis://default:" + fixture["password"] + "@redis.aegisgate-cache.svc.cluster.local:6379/0"
			}
			if value != expected {
				t.Fatal("incorrect credential rendering")
			}
			invalid := []struct{ key, value string }{
				{"username", "admin"}, {"database", "1"}, {"port", "6380"},
				{"password", ""}, {"password", "foo\nprotected-mode no"},
				{"password", "a b"}, {"password", "a\"b"}, {"password", "a@b/c"},
			}
			for _, bad := range invalid {
				previous := fixture[bad.key]
				fixture[bad.key] = bad.value
				if _, err := render(source, fixture); err == nil {
					t.Errorf("accepted invalid %s", bad.key)
				}
				fixture[bad.key] = previous
			}
			delete(fixture, "password")
			if _, err := render(source, fixture); err == nil {
				t.Fatal("accepted missing password")
			}
		})
	}
}
