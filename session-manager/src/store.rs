use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct Store(pub redis::aio::ConnectionManager);

#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    pub subject: String,
    pub name: String,
    pub provider: String,
    pub roles: Vec<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub csrf: String,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn random() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn valid_id(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

impl Store {
    pub async fn put<T: Serialize>(&self, key: &str, value: &T, ttl: u64) -> anyhow::Result<()> {
        let _: () = self
            .0
            .clone()
            .set_ex(key, serde_json::to_string(value)?, ttl)
            .await?;
        Ok(())
    }
    pub async fn take<T: for<'de> Deserialize<'de>>(&self, key: &str) -> anyhow::Result<Option<T>> {
        let raw: Option<String> = redis::cmd("GETDEL")
            .arg(key)
            .query_async(&mut self.0.clone())
            .await?;
        raw.map(|v| serde_json::from_str(&v).map_err(Into::into))
            .transpose()
    }
    pub async fn delete(&self, key: &str) -> anyhow::Result<()> {
        let _: usize = self.0.clone().del(key).await?;
        Ok(())
    }
    pub async fn session(&self, token: &str, idle: u64) -> anyhow::Result<Option<Session>> {
        if !valid_id(token) {
            return Ok(None);
        }
        // Read + sliding expiration is atomic; a concurrent logout cannot resurrect a session.
        let script = redis::Script::new(
            r#"
            local value = redis.call('GET', KEYS[1])
            if not value then return nil end
            local remaining = cjson.decode(value).expires_at - tonumber(ARGV[1])
            if remaining <= 0 then redis.call('DEL', KEYS[1]); return nil end
            redis.call('EXPIRE', KEYS[1], math.min(remaining, tonumber(ARGV[2])))
            return value
        "#,
        );
        let value: Option<String> = script
            .key(format!("session:{}", digest(token)))
            .arg(now())
            .arg(idle)
            .invoke_async(&mut self.0.clone())
            .await?;
        value
            .map(|v| serde_json::from_str(&v).map_err(Into::into))
            .transpose()
    }
    pub async fn sessions(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        let mut conn = self.0.clone();
        let mut cursor = 0u64;
        let mut out = Vec::new();
        loop {
            let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg("session:*")
                .arg("COUNT")
                .arg(100)
                .query_async(&mut conn)
                .await?;
            for key in keys {
                let raw: Option<String> = conn.get(&key).await?;
                if let Some(raw) = raw {
                    let session: Session = serde_json::from_str(&raw)?;
                    if session.expires_at > now() {
                        out.push(serde_json::json!({"id":key.trim_start_matches("session:"), "name":session.name, "provider":session.provider, "roles":session.roles, "created_at":session.created_at, "expires_at":session.expires_at}));
                    }
                }
            }
            cursor = next;
            if cursor == 0 || out.len() >= 500 {
                break;
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires isolated Redis via REDIS_TEST_URL"]
    async fn redis_expiry_and_revocation_do_not_resurrect_sessions() {
        let url =
            std::env::var("REDIS_TEST_URL").expect("set REDIS_TEST_URL to isolated test Redis");
        let store = Store(
            redis::Client::open(url)
                .unwrap()
                .get_connection_manager()
                .await
                .unwrap(),
        );
        let session = Session {
            subject: "test".into(),
            name: "test".into(),
            provider: "test".into(),
            roles: vec!["viewer".into()],
            created_at: now(),
            expires_at: now() + 60,
            csrf: random(),
        };
        let token = random();
        let key = format!("session:{}", digest(&token));
        store.put(&key, &session, 1).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        assert!(
            store.session(&token, 10).await.unwrap().is_none(),
            "idle expiration must deny access"
        );
        let mut expired = session.clone();
        expired.expires_at = now() - 1;
        store.put(&key, &expired, 60).await.unwrap();
        assert!(
            store.session(&token, 10).await.unwrap().is_none(),
            "absolute expiration must override Redis TTL"
        );
        store.put(&key, &session, 60).await.unwrap();
        let (read, deleted) = tokio::join!(store.session(&token, 60), store.delete(&key));
        read.unwrap();
        deleted.unwrap();
        assert!(
            store.session(&token, 60).await.unwrap().is_none(),
            "concurrent reads must not restore a revoked session"
        );
        assert!(store.session("invalid-cookie", 60).await.unwrap().is_none());
    }
}
