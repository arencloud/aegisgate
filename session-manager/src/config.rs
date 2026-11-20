use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub issuer: String,
    pub client_id: String,
    pub client_secret_env: String,
    /// JSON pointer into the verified ID token, e.g. /realm_access/roles or /roles.
    pub roles_pointer: String,
    pub role_mapping: BTreeMap<String, String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Rule {
    pub method: String,
    pub path: String,
    pub roles: Vec<String>,
}

#[derive(Clone, Deserialize)]
pub struct Config {
    pub providers: Vec<Provider>,
    pub rules: Vec<Rule>,
    pub idle_seconds: u64,
    pub absolute_seconds: u64,
}

impl Config {
    pub fn validate(&self, insecure: bool) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.idle_seconds > 0 && self.absolute_seconds >= self.idle_seconds,
            "invalid session lifetime"
        );
        let mut ids = std::collections::HashSet::new();
        for p in &self.providers {
            anyhow::ensure!(
                !p.id.is_empty() && p.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "invalid provider ID"
            );
            anyhow::ensure!(ids.insert(&p.id), "duplicate provider ID");
            anyhow::ensure!(
                insecure || p.issuer.starts_with("https://"),
                "HTTPS issuer required"
            );
            anyhow::ensure!(
                !std::env::var(&p.client_secret_env)?.is_empty(),
                "missing client secret"
            );
        }
        Ok(())
    }

    pub fn allows(&self, roles: &[String], method: &str, path: &str) -> bool {
        // Exact paths only: never authorize a prefix that can hide a privileged subresource.
        self.rules.iter().any(|r| {
            r.method == method && r.path == path && r.roles.iter().any(|role| roles.contains(role))
        })
    }
}

pub fn mapped_roles(provider: &Provider, claims: &serde_json::Value) -> Vec<String> {
    let mut roles: Vec<String> = claims
        .pointer(&provider.roles_pointer)
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .filter_map(|role| provider.role_mapping.get(role).cloned())
        .collect();
    roles.sort();
    roles.dedup();
    roles
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deny_by_default_and_match_method_and_path_exactly() {
        let cfg = Config {
            providers: vec![],
            idle_seconds: 60,
            absolute_seconds: 120,
            rules: vec![Rule {
                method: "GET".into(),
                path: "/api/projects".into(),
                roles: vec!["viewer".into()],
            }],
        };
        assert!(cfg.allows(&["viewer".into()], "GET", "/api/projects"));
        for (method, path) in [
            ("POST", "/api/projects"),
            ("GET", "/api/projects/admin"),
            ("GET", "/api/%70rojects"),
            ("GET", "/api/../admin"),
        ] {
            assert!(!cfg.allows(&["viewer".into()], method, path));
        }
        assert!(!cfg.allows(&[], "GET", "/api/projects"));
    }
    #[test]
    fn unknown_external_roles_do_not_grant_access() {
        let provider: Provider = serde_json::from_value(serde_json::json!({"id":"entra", "name":"Entra", "issuer":"https://example.com", "client_id":"id", "client_secret_env":"SECRET", "roles_pointer":"/roles", "role_mapping":{"Aegis.Reader":"viewer"}})).unwrap();
        assert_eq!(
            mapped_roles(
                &provider,
                &serde_json::json!({"roles":["admin","Aegis.Reader"]})
            ),
            vec!["viewer"]
        );
        assert!(mapped_roles(&provider, &serde_json::json!({})).is_empty());
    }
}
