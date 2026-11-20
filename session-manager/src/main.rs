mod config;
mod oidc;
mod store;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use redis::AsyncCommands;
use serde_json::json;
use std::{sync::Arc, time::Duration};
use store::{Session, Store};

#[derive(Clone)]
struct App {
    config: Arc<config::Config>,
    store: Store,
    http: reqwest::Client,
    origin: String,
    backend: String,
    backend_token: String,
    insecure: bool,
}
struct AppError(StatusCode, &'static str);
impl AppError {
    fn internal(err: impl std::fmt::Display) -> Self {
        // Avoid logging OIDC codes, tokens, credentials, request URLs or session material.
        let _ = err;
        tracing::error!("dependency or configuration operation failed");
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            "A required service is unavailable",
        )
    }
    fn unauthorized() -> Self {
        Self(StatusCode::UNAUTHORIZED, "Sign in to continue")
    }
    fn forbidden() -> Self {
        Self(
            StatusCode::FORBIDDEN,
            "Your role does not permit this action",
        )
    }
    fn not_found() -> Self {
        Self(StatusCode::NOT_FOUND, "Not found")
    }
}
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
fn cookies(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all("cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|v| v.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
}
fn cookie_name(insecure: bool, name: &str) -> String {
    if insecure {
        name.to_owned()
    } else {
        format!("__Host-{name}")
    }
}
fn browser_cookie(app: &App, headers: &HeaderMap, name: &str) -> Option<String> {
    cookies(headers, &cookie_name(app.insecure, name))
}
fn cookie(app: &App, name: &str, value: &str, age: u64) -> Result<HeaderValue, AppError> {
    let name = cookie_name(app.insecure, name);
    format!(
        "{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
        if app.insecure { "" } else { "; Secure" }
    )
    .parse()
    .map_err(AppError::internal)
}
async fn session(app: &App, headers: &HeaderMap) -> Result<Session, AppError> {
    let token = browser_cookie(app, headers, "ag_session").ok_or_else(AppError::unauthorized)?;
    app.store
        .session(&token, app.config.idle_seconds)
        .await
        .map_err(AppError::internal)?
        .ok_or_else(AppError::unauthorized)
}
fn csrf(app: &App, headers: &HeaderMap, session: &Session) -> Result<(), AppError> {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let token = headers
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if origin != Some(app.origin.as_str()) || store::digest(token) != store::digest(&session.csrf) {
        return Err(AppError::forbidden());
    }
    Ok(())
}
async fn audit(app: &App, session: &Session, action: &str, outcome: &str) -> Result<(), AppError> {
    let event = json!({"id":uuid::Uuid::new_v4().to_string(), "time": store::now(), "actor": session.name, "provider":session.provider, "action":action, "outcome":outcome});
    let _: () = redis::pipe()
        .atomic()
        .lpush("audit", event.to_string())
        .ignore()
        .ltrim("audit", 0, 199)
        .ignore()
        .query_async(&mut app.store.0.clone())
        .await
        .map_err(AppError::internal)?;
    Ok(())
}
async fn health(State(app): State<App>) -> Result<Json<serde_json::Value>, AppError> {
    let _: String = redis::cmd("PING")
        .query_async(&mut app.store.0.clone())
        .await
        .map_err(AppError::internal)?;
    Ok(Json(json!({"status":"up"})))
}
async fn providers(State(app): State<App>) -> Json<serde_json::Value> {
    Json(
        json!({"providers": app.config.providers.iter().map(|p| json!({"id":p.id,"name":p.name})).collect::<Vec<_>>()}),
    )
}
async fn me(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let s = session(&app, &headers).await?;
    Ok(Json(
        json!({"name":s.name,"provider":s.provider,"roles":s.roles,"created_at":s.created_at,"expires_at":s.expires_at,"csrf":s.csrf}),
    ))
}
async fn logout(State(app): State<App>, headers: HeaderMap) -> Result<Response, AppError> {
    let s = session(&app, &headers).await?;
    csrf(&app, &headers, &s)?;
    let token = browser_cookie(&app, &headers, "ag_session").ok_or_else(AppError::unauthorized)?;
    app.store
        .delete(&format!("session:{}", store::digest(&token)))
        .await
        .map_err(AppError::internal)?;
    audit(&app, &s, "Session signed out", "allowed").await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert("set-cookie", cookie(&app, "ag_session", "", 0)?);
    Ok(response)
}
async fn sessions(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let s = session(&app, &headers).await?;
    if !s.roles.iter().any(|r| r == "admin") {
        return Err(AppError::forbidden());
    }
    Ok(Json(
        json!({"sessions":app.store.sessions().await.map_err(AppError::internal)?}),
    ))
}
async fn revoke(
    State(app): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let s = session(&app, &headers).await?;
    csrf(&app, &headers, &s)?;
    if !s.roles.iter().any(|r| r == "admin") {
        return Err(AppError::forbidden());
    }
    if !store::valid_id(&id) {
        return Err(AppError::not_found());
    }
    app.store
        .delete(&format!("session:{id}"))
        .await
        .map_err(AppError::internal)?;
    audit(&app, &s, "Session revoked", "allowed").await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn policy(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    session(&app, &headers).await?;
    Ok(Json(
        json!({"rules":app.config.rules,"idle_seconds":app.config.idle_seconds,"absolute_seconds":app.config.absolute_seconds}),
    ))
}
async fn events(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let s = session(&app, &headers).await?;
    if !s.roles.iter().any(|r| r == "admin") {
        return Err(AppError::forbidden());
    }
    let raw: Vec<String> = app
        .store
        .0
        .clone()
        .lrange("audit", 0, 99)
        .await
        .map_err(AppError::internal)?;
    let events: Vec<serde_json::Value> = raw
        .iter()
        .filter_map(|v| serde_json::from_str(v).ok())
        .collect();
    Ok(Json(json!({"events":events})))
}
// RHCL/Authorino metadata endpoint. No identity or session secrets are returned.
// This route is not exposed by the public HTTPRoute or UI reverse proxy.
async fn check(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let method = headers
        .get("x-original-method")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let path = headers
        .get("x-original-path")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    let s = match session(&app, &headers).await {
        Ok(s) => s,
        Err(AppError(StatusCode::UNAUTHORIZED, _)) => return Ok(Json(json!({"allowed":false}))),
        Err(e) => return Err(e),
    };
    Ok(Json(
        json!({"allowed":app.config.allows(&s.roles, method, path)}),
    ))
}
async fn proxy(
    State(app): State<App>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let s = session(&app, &headers).await?;
    if !app.config.allows(&s.roles, method.as_str(), uri.path()) {
        audit(&app, &s, &format!("{} {}", method, uri.path()), "denied").await?;
        return Err(AppError::forbidden());
    }
    if !matches!(method, Method::GET | Method::HEAD) {
        csrf(&app, &headers, &s)?;
    }
    // Fixed upstream + explicitly allowed paths; no forwarded identity headers, browser tokens,
    // arbitrary destinations or credentials cross this boundary.
    let target = format!(
        "{}{}",
        app.backend,
        uri.path_and_query().map(|v| v.as_str()).unwrap_or("/")
    );
    let mut request = app
        .http
        .request(method.clone(), target)
        .header("x-aegis-internal", &app.backend_token)
        .header("x-aegis-roles", s.roles.join(","));
    if let Some(content_type) = headers.get("content-type") {
        request = request.header("content-type", content_type);
    }
    let result = request
        .body(body)
        .send()
        .await
        .map_err(AppError::internal)?;
    let status = result.status();
    let content_type = result
        .headers()
        .get("content-type")
        .cloned()
        .unwrap_or(HeaderValue::from_static("application/json"));
    let body = result.bytes().await.map_err(AppError::internal)?;
    audit(
        &app,
        &s,
        &format!("{} {}", method, uri.path()),
        if status.is_success() {
            "allowed"
        } else {
            "upstream error"
        },
    )
    .await?;
    Ok((status, [("content-type", content_type)], body).into_response())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()))
        .init();
    let insecure = std::env::var("ALLOW_INSECURE_LOCALHOST").as_deref() == Ok("true");
    let origin = std::env::var("PUBLIC_ORIGIN")?
        .trim_end_matches('/')
        .to_owned();
    let url = reqwest::Url::parse(&origin)?;
    anyhow::ensure!(
        url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
            && url.username().is_empty()
            && url.password().is_none(),
        "PUBLIC_ORIGIN must be an origin"
    );
    anyhow::ensure!(
        url.scheme() == "https"
            || (insecure
                && url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))),
        "HTTP is only allowed on localhost"
    );
    anyhow::ensure!(
        !insecure || matches!(url.host_str(), Some("localhost" | "127.0.0.1")),
        "ALLOW_INSECURE_LOCALHOST cannot be enabled on a non-local origin"
    );
    let config: config::Config = serde_json::from_str(&std::fs::read_to_string(
        std::env::var("CONFIG_PATH").unwrap_or_else(|_| "config.json".into()),
    )?)?;
    config.validate(insecure)?;
    let backend_token = std::env::var("BACKEND_TOKEN")?;
    anyhow::ensure!(
        backend_token.len() >= 32,
        "BACKEND_TOKEN must contain at least 32 characters"
    );
    let redis = redis::Client::open(std::env::var("REDIS_URL")?)?
        .get_connection_manager()
        .await?;
    let mut http_builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10));
    if let Ok(path) = std::env::var("OIDC_CA_BUNDLE") {
        let certificates = reqwest::Certificate::from_pem_bundle(&std::fs::read(path)?)?;
        anyhow::ensure!(
            !certificates.is_empty(),
            "OIDC_CA_BUNDLE contains no certificates"
        );
        for certificate in certificates {
            http_builder = http_builder.add_root_certificate(certificate);
        }
    }
    // Docker-only loopback mapping: the browser and verifier retain the same issuer.
    if let Ok(address) = std::env::var("OIDC_LOCAL_ADDRESS") {
        anyhow::ensure!(insecure, "OIDC_LOCAL_ADDRESS is local-only");
        let addr = tokio::net::lookup_host(address)
            .await?
            .next()
            .ok_or_else(|| anyhow::anyhow!("local provider DNS failed"))?;
        http_builder = http_builder.resolve("localhost", addr);
    }
    let app = App {
        config: Arc::new(config),
        store: Store(redis),
        origin,
        backend: std::env::var("BACKEND_URL")?
            .trim_end_matches('/')
            .to_owned(),
        backend_token,
        insecure,
        http: http_builder.build()?,
    };
    let check_address = std::env::var("SESSION_CHECK_ADDRESS").ok();
    let mut router = Router::new()
        .route("/healthz", get(health))
        .route("/auth/providers", get(providers))
        .route("/auth/login/{provider}", get(oidc::login))
        .route("/auth/callback", get(oidc::callback))
        .route("/auth/me", get(me))
        .route("/auth/logout", post(logout))
        .route("/auth/policy", get(policy))
        .route("/auth/sessions", get(sessions))
        .route("/auth/sessions/{id}", delete(revoke))
        .route("/auth/events", get(events))
        .route("/api/{*path}", axum::routing::any(proxy));
    // Local Compose retains its original single listener. In the cluster the
    // check-only listener is protected by Authorino's exact mTLS identity.
    if check_address.is_none() {
        router = router.route("/internal/check", get(check));
    }
    let router = router
        .layer(DefaultBodyLimit::max(65536))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .with_state(app.clone());
    let address = std::env::var("LISTEN_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8081".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    tracing::info!("session manager listener ready");
    if let Some(address) = check_address {
        let check_listener = tokio::net::TcpListener::bind(address).await?;
        let checks = check_router().with_state(app);
        tokio::try_join!(
            axum::serve(listener, router)
                .with_graceful_shutdown(shutdown())
                .into_future(),
            axum::serve(check_listener, checks)
                .with_graceful_shutdown(shutdown())
                .into_future(),
        )?;
    } else {
        axum::serve(listener, router)
            .with_graceful_shutdown(shutdown())
            .await?;
    }
    Ok(())
}

fn check_router() -> Router<App> {
    Router::new()
        .route(
            "/internal/check",
            get(check).head(|| async { StatusCode::METHOD_NOT_ALLOWED }),
        )
        .layer(DefaultBodyLimit::max(65536))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_cookies_require_the_host_prefix() {
        assert_eq!(cookie_name(false, "ag_session"), "__Host-ag_session");
        assert_eq!(cookie_name(false, "ag_login"), "__Host-ag_login");
        assert_eq!(cookie_name(true, "ag_session"), "ag_session");
    }
    #[test]
    fn cookie_lookup_does_not_match_similar_names() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "cookie",
            "fake_ag_session=evil; ag_session=good; other=value"
                .parse()
                .unwrap(),
        );
        assert_eq!(cookies(&headers, "ag_session"), Some("good".into()));
        assert_eq!(cookies(&headers, "missing"), None);
    }
}
