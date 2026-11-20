use crate::{
    App, AppError, browser_cookie,
    config::mapped_roles,
    cookie,
    store::{self, Session},
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Redirect, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope,
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Pending {
    provider: String,
    nonce: String,
    verifier: String,
    binding: String,
}
#[derive(Deserialize)]
pub struct Callback {
    code: String,
    state: String,
}

// Discovery is per login/callback, so key rotation is observed without restarting the service.
async fn metadata(
    app: &App,
    provider: &crate::config::Provider,
) -> Result<CoreProviderMetadata, AppError> {
    CoreProviderMetadata::discover_async(
        IssuerUrl::new(provider.issuer.clone()).map_err(AppError::internal)?,
        &app.http,
    )
    .await
    .map_err(AppError::internal)
}

pub async fn login(State(app): State<App>, Path(id): Path<String>) -> Result<Response, AppError> {
    let p = app
        .config
        .providers
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(AppError::not_found)?;
    let client = CoreClient::from_provider_metadata(
        metadata(&app, p).await?,
        ClientId::new(p.client_id.clone()),
        Some(ClientSecret::new(
            std::env::var(&p.client_secret_env).map_err(AppError::internal)?,
        )),
    )
    .set_redirect_uri(
        RedirectUrl::new(format!("{}/auth/callback", app.origin)).map_err(AppError::internal)?,
    );
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (url, state, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("profile".into()))
        .add_scope(Scope::new("email".into()))
        .set_pkce_challenge(challenge)
        .url();
    let binding = store::random();
    app.store
        .put(
            &format!("login:{}", store::digest(state.secret())),
            &Pending {
                provider: p.id.clone(),
                nonce: nonce.secret().clone(),
                verifier: verifier.secret().clone(),
                binding: store::digest(&binding),
            },
            300,
        )
        .await
        .map_err(AppError::internal)?;
    let mut response = Redirect::to(url.as_str()).into_response();
    response
        .headers_mut()
        .insert("set-cookie", cookie(&app, "ag_login", &binding, 300)?);
    Ok(response)
}

pub async fn callback(
    State(app): State<App>,
    Query(query): Query<Callback>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let pending: Pending = app
        .store
        .take(&format!("login:{}", store::digest(&query.state)))
        .await
        .map_err(AppError::internal)?
        .ok_or_else(AppError::unauthorized)?;
    let binding = browser_cookie(&app, &headers, "ag_login").ok_or_else(AppError::unauthorized)?;
    if store::digest(&binding) != pending.binding {
        return Err(AppError::unauthorized());
    }
    let p = app
        .config
        .providers
        .iter()
        .find(|p| p.id == pending.provider)
        .ok_or_else(AppError::unauthorized)?;
    let client = CoreClient::from_provider_metadata(
        metadata(&app, p).await?,
        ClientId::new(p.client_id.clone()),
        Some(ClientSecret::new(
            std::env::var(&p.client_secret_env).map_err(AppError::internal)?,
        )),
    )
    .set_redirect_uri(
        RedirectUrl::new(format!("{}/auth/callback", app.origin)).map_err(AppError::internal)?,
    );
    let tokens = client
        .exchange_code(AuthorizationCode::new(query.code))
        .map_err(AppError::internal)?
        .set_pkce_verifier(PkceCodeVerifier::new(pending.verifier))
        .request_async(&app.http)
        .await
        .map_err(|_| AppError::unauthorized())?;
    let id_token = tokens
        .extra_fields()
        .id_token()
        .ok_or_else(AppError::unauthorized)?;
    let verifier = client.id_token_verifier();
    let claims = id_token
        .claims(&verifier, &Nonce::new(pending.nonce))
        .map_err(|_| AppError::unauthorized())?;
    if let Some(expected) = claims.access_token_hash() {
        let actual = AccessTokenHash::from_token(
            tokens.access_token(),
            id_token.signing_alg().map_err(AppError::internal)?,
            id_token
                .signing_key(&verifier)
                .map_err(AppError::internal)?,
        )
        .map_err(AppError::internal)?;
        if actual != *expected {
            return Err(AppError::unauthorized());
        }
    }
    // Parse provider-specific roles ONLY after the library verifies signature, issuer, audience,
    // nonce and expiry on this exact token. Never accept roles from browser-supplied headers.
    let token = id_token.to_string();
    let payload = token.split('.').nth(1).ok_or_else(AppError::unauthorized)?;
    let raw: serde_json::Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(AppError::internal)?,
    )
    .map_err(AppError::internal)?;
    let now = store::now();
    let expires_at =
        (now + app.config.absolute_seconds).min(claims.expiration().timestamp().max(0) as u64);
    if expires_at <= now {
        return Err(AppError::unauthorized());
    }
    let session = Session {
        subject: format!("{}|{}", p.id, claims.subject().as_str()),
        name: raw
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(claims.subject().as_str())
            .to_string(),
        provider: p.id.clone(),
        roles: mapped_roles(p, &raw),
        created_at: now,
        expires_at,
        csrf: store::random(),
    };
    // Rotate an existing browser session on every successful login.
    if let Some(old) = browser_cookie(&app, &headers, "ag_session") {
        app.store
            .delete(&format!("session:{}", store::digest(&old)))
            .await
            .map_err(AppError::internal)?;
    }
    let token = store::random();
    app.store
        .put(
            &format!("session:{}", store::digest(&token)),
            &session,
            app.config.idle_seconds.min(expires_at - now),
        )
        .await
        .map_err(AppError::internal)?;
    let mut response = Redirect::to("/").into_response();
    response.headers_mut().append(
        "set-cookie",
        cookie(&app, "ag_session", &token, expires_at - now)?,
    );
    response
        .headers_mut()
        .append("set-cookie", cookie(&app, "ag_login", "", 0)?);
    Ok(response)
}
