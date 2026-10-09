mod db;
mod drafts;
mod error;
mod search;

use std::{env, error::Error, net::SocketAddr, sync::Arc};

use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use deadpool_postgres::Pool;

const PAGE: &str = include_str!("../web/index.html");

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt::init();

    let url = env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is not set")?;
    let pool = db::connect(&url)?;
    db::migrate(&pool).await?;

    serve(pool).await
}

async fn serve(pool: Pool) -> Result<(), Box<dyn Error>> {
    let addr: SocketAddr = env::var("LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".into())
        .parse()?;

    // Where the page is mounted when an ingress serves it below a path it
    // shares with something else, e.g. `/library`. Empty means the root.
    let base = env::var("BASE_PATH").unwrap_or_default();
    let base = base.trim_end_matches('/').to_string();
    if !base.is_empty() && !base.starts_with('/') {
        return Err("BASE_PATH must start with /".into());
    }

    let html = PAGE.replace("__BASE_PATH__", &base);
    let page = move || {
        let html = html.clone();
        async move { ([(header::CACHE_CONTROL, "no-cache")], Html(html)) }
    };
    let site = Router::new()
        .route("/", get(page.clone()))
        .route("/api/search", get(search::search))
        .route("/api/drafts", get(drafts::list).post(drafts::create))
        .route(
            "/api/drafts/{id}",
            get(drafts::get).put(drafts::update).delete(drafts::delete),
        )
        .route("/api/drafts/{id}/file", get(drafts::file));
    let mut site = if base.is_empty() {
        site
    } else {
        Router::new()
            .nest(&base, site)
            .route(&format!("{base}/"), get(page))
    };

    // One shared login, `user:password`, for a gateway that cannot ask for
    // one itself. The page has no logins of its own.
    match env::var("BASIC_AUTH") {
        Ok(login) if !login.trim().is_empty() => {
            let expected: Arc<str> = format!("Basic {}", STANDARD.encode(login.trim())).into();
            site = site.layer(middleware::from_fn(move |request: Request, next: Next| {
                require_login(expected.clone(), request, next)
            }));
        }
        _ => tracing::warn!("BASIC_AUTH is not set: the page and every draft are open"),
    }

    let app = site.with_state(pool);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn require_login(expected: Arc<str>, request: Request, next: Next) -> Response {
    let given = request
        .headers()
        .get(header::AUTHORIZATION)
        .map(|value| value.as_bytes());
    if given.is_some_and(|given| same(given, expected.as_bytes())) {
        return next.run(request).await;
    }
    (
        StatusCode::UNAUTHORIZED,
        [(
            header::WWW_AUTHENTICATE,
            "Basic realm=\"Library search\", charset=\"UTF-8\"",
        )],
    )
        .into_response()
}

/// Compares in time that depends on the lengths alone, not on where the two
/// first differ.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn shutdown() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
    tokio::select! {
        _ = term.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
}
