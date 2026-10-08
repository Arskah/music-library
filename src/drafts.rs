use std::collections::HashSet;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use deadpool_postgres::{Object, Pool};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_postgres::{types::Json as Jsonb, Row};
use uuid::Uuid;

use crate::{
    db,
    error::{ApiError, ApiResult},
    search::CONTENT_TYPES,
};

/// The saved playlist file the app imports (`docs/saved-playlists.md`, "The file").
const FILE_FORMAT: &str = "radiodiodj-playlist";
const FILE_VERSION: u32 = 1;

const MAX_ENTRIES: usize = 2000;
const MAX_NAME: usize = 200;

const TIMESTAMP: &str = r#"'YYYY-MM-DD"T"HH24:MI:SS"Z"'"#;

/// One entry of the file: no track id and no path.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    fingerprint: String,
    #[serde(default)]
    artist: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    content_type: Option<String>,
}

#[derive(Deserialize)]
pub struct DraftInput {
    name: String,
    author: String,
    #[serde(default)]
    entries: Vec<Entry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    id: Uuid,
    name: String,
    author: String,
    created_at: String,
    updated_at: String,
    entries: Vec<Entry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    id: Uuid,
    name: String,
    author: String,
    created_at: String,
    updated_at: String,
    entry_count: i32,
}

fn draft_columns() -> String {
    format!(
        "id, name, author, to_char(created_at AT TIME ZONE 'UTC', {TIMESTAMP}), \
         to_char(updated_at AT TIME ZONE 'UTC', {TIMESTAMP})"
    )
}

fn draft(row: &Row) -> Draft {
    Draft {
        id: row.get(0),
        name: row.get(1),
        author: row.get(2),
        created_at: row.get(3),
        updated_at: row.get(4),
        entries: row.get::<_, Jsonb<Vec<Entry>>>(5).0,
    }
}

/// Checks the input and returns it trimmed. `kept` is the fingerprints the
/// draft already holds, which stay valid after their track leaves the
/// catalogue.
async fn validate(
    client: &mut Object,
    input: DraftInput,
    kept: &HashSet<String>,
) -> ApiResult<DraftInput> {
    let name = input.name.trim().to_string();
    let author = input.author.trim().to_string();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(ApiError::BadRequest(format!(
            "name must be 1 to {MAX_NAME} characters"
        )));
    }
    if author.is_empty() || author.chars().count() > MAX_NAME {
        return Err(ApiError::BadRequest(format!(
            "author must be 1 to {MAX_NAME} characters"
        )));
    }
    if input.entries.len() > MAX_ENTRIES {
        return Err(ApiError::BadRequest(format!(
            "a draft holds at most {MAX_ENTRIES} entries"
        )));
    }
    for entry in &input.entries {
        if let Some(t) = &entry.content_type {
            if !CONTENT_TYPES.contains(&t.as_str()) {
                return Err(ApiError::BadRequest(format!("unknown content type {t:?}")));
            }
        }
        if entry.duration.is_some_and(|d| !d.is_finite() || d < 0.0) {
            return Err(ApiError::BadRequest("duration must be 0 or more".into()));
        }
    }

    // An entry the app cannot bind is the one thing the page must not hand
    // back, so a fingerprint has to come from the catalogue.
    let new: Vec<&str> = input
        .entries
        .iter()
        .map(|e| e.fingerprint.as_str())
        .filter(|f| !kept.contains(*f))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !new.is_empty() {
        let mut known: HashSet<String> = HashSet::new();
        if db::catalogue(client, false).await? {
            let rows = client
                .query(
                    "SELECT DISTINCT fingerprint FROM hub_catalogue WHERE fingerprint = ANY($1)",
                    &[&new],
                )
                .await?;
            known.extend(rows.iter().map(|r| r.get::<_, String>(0)));
        }
        let unknown = new.iter().filter(|f| !known.contains(**f)).count();
        if unknown > 0 {
            return Err(ApiError::Unprocessable(format!(
                "{unknown} entries carry a fingerprint that is not in the catalogue"
            )));
        }
    }

    Ok(DraftInput {
        name,
        author,
        entries: input.entries,
    })
}

async fn load(client: &Object, id: Uuid) -> ApiResult<Draft> {
    let row = client
        .query_opt(
            &format!(
                "SELECT {}, entries FROM web_drafts WHERE id = $1",
                draft_columns()
            ),
            &[&id],
        )
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(draft(&row))
}

pub async fn list(State(pool): State<Pool>) -> ApiResult<Json<Vec<DraftSummary>>> {
    let client = pool.get().await?;
    let rows = client
        .query(
            &format!(
                "SELECT {}, jsonb_array_length(entries) FROM web_drafts
                 ORDER BY updated_at DESC",
                draft_columns()
            ),
            &[],
        )
        .await?;
    Ok(Json(
        rows.iter()
            .map(|row| DraftSummary {
                id: row.get(0),
                name: row.get(1),
                author: row.get(2),
                created_at: row.get(3),
                updated_at: row.get(4),
                entry_count: row.get(5),
            })
            .collect(),
    ))
}

pub async fn create(
    State(pool): State<Pool>,
    Json(input): Json<DraftInput>,
) -> ApiResult<(StatusCode, Json<Draft>)> {
    let mut client = pool.get().await?;
    let input = validate(&mut client, input, &HashSet::new()).await?;
    let row = client
        .query_one(
            &format!(
                "INSERT INTO web_drafts (name, author, entries) VALUES ($1, $2, $3)
                 RETURNING {}, entries",
                draft_columns()
            ),
            &[&input.name, &input.author, &Jsonb(&input.entries)],
        )
        .await?;
    Ok((StatusCode::CREATED, Json(draft(&row))))
}

pub async fn get(State(pool): State<Pool>, Path(id): Path<Uuid>) -> ApiResult<Json<Draft>> {
    let client = pool.get().await?;
    Ok(Json(load(&client, id).await?))
}

pub async fn update(
    State(pool): State<Pool>,
    Path(id): Path<Uuid>,
    Json(input): Json<DraftInput>,
) -> ApiResult<Json<Draft>> {
    let mut client = pool.get().await?;
    let kept: HashSet<String> = load(&client, id)
        .await?
        .entries
        .into_iter()
        .map(|e| e.fingerprint)
        .collect();
    let input = validate(&mut client, input, &kept).await?;
    let row = client
        .query_opt(
            &format!(
                "UPDATE web_drafts SET name = $2, author = $3, entries = $4, updated_at = now()
                 WHERE id = $1
                 RETURNING {}, entries",
                draft_columns()
            ),
            &[&id, &input.name, &input.author, &Jsonb(&input.entries)],
        )
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(draft(&row)))
}

pub async fn delete(State(pool): State<Pool>, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let client = pool.get().await?;
    match client
        .execute("DELETE FROM web_drafts WHERE id = $1", &[&id])
        .await?
    {
        0 => Err(ApiError::NotFound),
        _ => Ok(StatusCode::NO_CONTENT),
    }
}

/// The draft as the file the app's import reads.
pub async fn file(
    State(pool): State<Pool>,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let client = pool.get().await?;
    let draft = load(&client, id).await?;

    let stem: String = draft
        .name
        .chars()
        .map(|c| match c {
            c if c.is_ascii_alphanumeric() => c,
            ' ' | '.' | '-' | '_' => c,
            _ => '_',
        })
        .collect();
    let body = json!({
        "format": FILE_FORMAT,
        "version": FILE_VERSION,
        "name": draft.name,
        "entries": draft.entries,
    });
    Ok((
        [(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{stem}.json\""),
        )],
        Json(body),
    ))
}
