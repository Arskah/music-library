use std::sync::{Arc, RwLock};

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::{ApiError, ApiResult};

/// The app's `X-{APP_NAME}-Signature` (`docs/now-playing-broadcast.md`).
const SIGNATURE: &str = "x-radiodiodj-signature";
const SCHEME: &str = "sha256=";

/// The events are a few hundred bytes. The cap is on a body that is read
/// whole before anything has vouched for its sender.
pub const MAX_BODY: usize = 64 * 1024;

/// What the app's now-playing webhook sends.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    #[serde(rename_all = "camelCase")]
    NowPlaying { track: Track, started_at: String },
    #[serde(rename_all = "camelCase")]
    Stopped { stopped_at: String },
    #[serde(rename_all = "camelCase")]
    Test { sent_at: String },
}

/// The event's track without its `id` and `path`, which are the studio
/// machine's own and mean nothing here.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    title: String,
    artist: String,
    album: String,
    #[serde(default)]
    genre: Option<String>,
    duration_sec: f64,
    content_type: String,
}

/// The secret the app signs with, and the last event it sent. The event is
/// kept in memory: a restart forgets it until the next track starts.
#[derive(Clone)]
pub struct Hook {
    secret: Arc<str>,
    last: Arc<RwLock<Option<Event>>>,
}

impl Hook {
    pub fn new(secret: &str) -> Self {
        Self {
            secret: secret.into(),
            last: Arc::default(),
        }
    }
}

fn unhex(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) || !hex.is_ascii() {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

/// Whether `header` is `sha256=` and the hex of HMAC-SHA256 over the body as
/// it arrived. The comparison is the MAC's own, in constant time.
fn signed(secret: &str, body: &[u8], header: &str) -> bool {
    let Some(given) = header.strip_prefix(SCHEME).and_then(unhex) else {
        return false;
    };
    let mut mac =
        <Hmac<Sha256>>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(body);
    mac.verify_slice(&given).is_ok()
}

/// Takes the bytes rather than `Json`: the signature is over the body as
/// sent, and nothing is parsed before it has been checked.
pub async fn receive(
    State(hook): State<Hook>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<StatusCode> {
    let header = headers.get(SIGNATURE).and_then(|value| value.to_str().ok());
    if !header.is_some_and(|header| signed(&hook.secret, &body, header)) {
        return Err(ApiError::Unauthorized);
    }

    let event: Event = serde_json::from_slice(&body)
        .map_err(|e| ApiError::BadRequest(format!("not a now-playing event: {e}")))?;
    match &event {
        Event::Test { .. } => tracing::info!("webhook: test event"),
        _ => *hook.last.write().expect("no writer panics") = Some(event),
    }
    Ok(StatusCode::NO_CONTENT)
}

/// The last `now_playing` or `stopped`, or `null` before the first. The app
/// cannot send a `stopped` when it crashes, so `startedAt` and `durationSec`
/// are what tell a track that should have ended.
pub async fn now_playing(State(hook): State<Hook>) -> Json<Option<Event>> {
    Json(hook.last.read().expect("no writer panics").clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The app's own regression value: HMAC-SHA256("hello", b"hi").
    const HI: &str = "sha256=42eb9553cf9288e53d3389208d00db1ac80d3666f1fa74fe02e1038672d0c83a";

    #[test]
    fn accepts_the_apps_signature() {
        assert!(signed("hello", b"hi", HI));
    }

    #[test]
    fn rejects_another_secret_body_or_shape() {
        assert!(!signed("hullo", b"hi", HI));
        assert!(!signed("hello", b"ho", HI));
        assert!(!signed("hello", b"hi", &HI[SCHEME.len()..]));
        assert!(!signed("hello", b"hi", &HI[..HI.len() - 2]));
        assert!(!signed("hello", b"hi", "sha256="));
        assert!(!signed("hello", b"hi", "sha256=zz"));
        assert!(!signed("hello", b"hi", "sha256=é"));
    }

    #[test]
    fn reads_the_apps_events() {
        let event: Event = serde_json::from_str(
            r#"{"event":"now_playing","track":{"id":123,"title":"Song","artist":"Artist",
                "album":"Album","genre":null,"durationSec":245.3,"contentType":"music",
                "path":"/abs/path/file.mp3"},"startedAt":"2026-05-19T14:23:11.482Z"}"#,
        )
        .unwrap();
        let out = serde_json::to_string(&event).unwrap();
        assert!(out.contains(r#""event":"now_playing""#));
        assert!(out.contains(r#""startedAt":"2026-05-19T14:23:11.482Z""#));
        assert!(out.contains(r#""durationSec":245.3"#));
        assert!(!out.contains("path"));

        let stopped = r#"{"event":"stopped","stoppedAt":"2026-05-19T14:27:16.901Z"}"#;
        assert_eq!(
            serde_json::to_string(&serde_json::from_str::<Event>(stopped).unwrap()).unwrap(),
            stopped
        );
        assert!(matches!(
            serde_json::from_str(r#"{"event":"test","sentAt":"2026-05-19T00:00:00Z"}"#),
            Ok(Event::Test { .. })
        ));
        assert!(serde_json::from_str::<Event>(r#"{"event":"other"}"#).is_err());
    }
}
