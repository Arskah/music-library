use axum::{
    extract::{Query, State},
    Json,
};
use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};
use tokio_postgres::Row;

use crate::{
    db,
    error::{ApiError, ApiResult},
};

pub const CONTENT_TYPES: [&str; 3] = ["music", "jingle", "commercial"];

/// The app's own cap (`Db::search`).
const LIMIT: i64 = 200;
/// The loose pass runs only when the exact one found fewer than this.
const LOOSE_BELOW: usize = 10;
/// Low enough for one transposition in a nine-letter word (`kraftwrek`).
const LOOSE_SIMILARITY: f32 = 0.45;
const MAX_TOKENS: usize = 16;

const COLUMNS: &str = "c.track_id, c.fingerprint, c.title, c.artist, c.album, c.album_artist, \
                       c.genre, c.duration, c.content_type";

#[derive(Deserialize)]
pub struct Params {
    #[serde(default)]
    q: String,
    #[serde(rename = "type")]
    content_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    track_id: i64,
    fingerprint: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    genre: Option<String>,
    duration: Option<f64>,
    content_type: String,
    /// Found by the loose pass, not by the words as typed.
    loose: bool,
}

#[derive(Serialize)]
pub struct Results {
    tracks: Vec<Track>,
    capped: bool,
    /// False until an owner has created the hub's tables.
    published: bool,
}

/// Splits where FTS5's `unicode61` would, so `ac/dc` is two words here too.
fn tokens(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .take(MAX_TOKENS)
        .map(str::to_lowercase)
        .collect()
}

fn track(row: &Row, loose: bool) -> Track {
    Track {
        track_id: row.get(0),
        fingerprint: row.get(1),
        title: row.get(2),
        artist: row.get(3),
        album: row.get(4),
        album_artist: row.get(5),
        genre: row.get(6),
        duration: row.get(7),
        content_type: row.get(8),
        loose,
    }
}

pub async fn search(
    State(pool): State<Pool>,
    Query(params): Query<Params>,
) -> ApiResult<Json<Results>> {
    let content_type = params.content_type.filter(|t| !t.is_empty());
    if let Some(t) = &content_type {
        if !CONTENT_TYPES.contains(&t.as_str()) {
            return Err(ApiError::BadRequest(format!("unknown content type {t:?}")));
        }
    }
    let tokens = tokens(&params.q);
    let mut client = pool.get().await?;
    if !db::catalogue(&mut client, false).await? {
        return Ok(Json(Results {
            tracks: Vec::new(),
            capped: false,
            published: false,
        }));
    }

    if tokens.is_empty() {
        let rows = client
            .query(
                &format!(
                    "SELECT {COLUMNS} FROM hub_catalogue c
                     WHERE NOT c.missing AND ($1::text IS NULL OR c.content_type = $1)
                     ORDER BY c.artist, c.album, c.title, c.track_id
                     LIMIT $2"
                ),
                &[&content_type, &LIMIT],
            )
            .await?;
        return Ok(Json(results(
            rows.iter().map(|r| track(r, false)).collect(),
        )));
    }

    // Prefix-AND, order-free: the search the app's library panel runs.
    let prefix_query = tokens
        .iter()
        .map(|t| format!("{t}:*"))
        .collect::<Vec<_>>()
        .join(" & ");
    let rows = client
        .query(
            &format!(
                "SELECT {COLUMNS}
                 FROM hub_catalogue c, to_tsquery('simple', fold($1)) q
                 WHERE NOT c.missing AND c.search @@ q
                   AND ($2::text IS NULL OR c.content_type = $2)
                 ORDER BY ts_rank(c.search, q) DESC, c.artist, c.album, c.title, c.track_id
                 LIMIT $3"
            ),
            &[&prefix_query, &content_type, &LIMIT],
        )
        .await?;
    let mut tracks: Vec<Track> = rows.iter().map(|r| track(r, false)).collect();

    if tracks.len() < LOOSE_BELOW {
        let found: Vec<i64> = tracks.iter().map(|t| t.track_id).collect();
        let room = LIMIT - tracks.len() as i64;
        // Every word must still match something. A word of one or two letters
        // gets no slack, as in the app's planned edit budget.
        let rows = client
            .query(
                &format!(
                    r"WITH toks AS (SELECT fold(t) AS t FROM unnest($1::text[]) AS t)
                      SELECT {COLUMNS}
                      FROM hub_catalogue c
                      WHERE NOT c.missing
                        AND ($2::text IS NULL OR c.content_type = $2)
                        AND c.track_id <> ALL($3::bigint[])
                        AND NOT EXISTS (
                          SELECT 1 FROM toks WHERE NOT CASE
                            WHEN char_length(t) <= 2 THEN c.search_text ~ ('\m' || t)
                            ELSE word_similarity(t, c.search_text) >= $4
                          END)
                      ORDER BY (SELECT sum(word_similarity(t, c.search_text)) FROM toks) DESC,
                               c.artist, c.album, c.title, c.track_id
                      LIMIT $5"
                ),
                &[&tokens, &content_type, &found, &LOOSE_SIMILARITY, &room],
            )
            .await?;
        tracks.extend(rows.iter().map(|r| track(r, true)));
    }

    Ok(Json(results(tracks)))
}

fn results(tracks: Vec<Track>) -> Results {
    Results {
        capped: tracks.len() as i64 >= LIMIT,
        published: true,
        tracks,
    }
}
