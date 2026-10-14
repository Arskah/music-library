import type pg from "pg";

import { CONTENT_TYPES, type Draft, type DraftInput, type DraftSummary } from "../schema.ts";
import { catalogue, withClient } from "./db.server.ts";
import { badRequest, notFound, unprocessable } from "../errors.ts";

/** The saved playlist file the app imports (`docs/saved-playlists.md`, "The file"). */
const FILE_FORMAT = "radiodiodj-playlist";
const FILE_VERSION = 1;

const MAX_ENTRIES = 2000;
const MAX_NAME = 200;

const TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
const DRAFT_COLUMNS = `id, name, author,
  to_char(created_at AT TIME ZONE 'UTC', ${TIMESTAMP}) AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', ${TIMESTAMP}) AS "updatedAt"`;

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** Checks a draft id from the path before Postgres sees it. */
function draftId(id: string): string {
  if (!UUID.test(id)) throw badRequest("invalid draft id");
  return id;
}

const isContentType = (t: string): boolean => (CONTENT_TYPES as readonly string[]).includes(t);

/** Checks the input and returns it trimmed. `kept` is the fingerprints the
 * draft already holds, which stay valid after their track leaves the
 * catalogue. */
async function validate(
  client: pg.PoolClient,
  input: DraftInput,
  kept: Set<string>,
): Promise<DraftInput> {
  const name = input.name.trim();
  const author = input.author.trim();
  if (name === "" || [...name].length > MAX_NAME) {
    throw badRequest(`name must be 1 to ${MAX_NAME} characters`);
  }
  if (author === "" || [...author].length > MAX_NAME) {
    throw badRequest(`author must be 1 to ${MAX_NAME} characters`);
  }
  if (input.entries.length > MAX_ENTRIES) {
    throw badRequest(`a draft holds at most ${MAX_ENTRIES} entries`);
  }
  for (const entry of input.entries) {
    if (entry.contentType !== null && !isContentType(entry.contentType)) {
      throw badRequest(`unknown content type ${JSON.stringify(entry.contentType)}`);
    }
    if (entry.duration !== null && !(Number.isFinite(entry.duration) && entry.duration >= 0)) {
      throw badRequest("duration must be 0 or more");
    }
  }

  // An entry the app cannot bind is the one thing the page must not hand
  // back, so a fingerprint has to come from the catalogue.
  const fresh = [...new Set(input.entries.map((e) => e.fingerprint))].filter((f) => !kept.has(f));
  if (fresh.length > 0) {
    const known = new Set<string>();
    if (await catalogue(client)) {
      const { rows } = await client.query<{ fingerprint: string }>(
        "SELECT DISTINCT fingerprint FROM hub_catalogue WHERE fingerprint = ANY($1)",
        [fresh],
      );
      for (const row of rows) known.add(row.fingerprint);
    }
    const unknown = fresh.filter((f) => !known.has(f)).length;
    if (unknown > 0) {
      throw unprocessable(`${unknown} entries carry a fingerprint that is not in the catalogue`);
    }
  }

  return { name, author, entries: input.entries };
}

async function load(client: pg.PoolClient, id: string): Promise<Draft | null> {
  const { rows } = await client.query<Draft>(
    `SELECT ${DRAFT_COLUMNS}, entries FROM web_drafts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export function list(): Promise<DraftSummary[]> {
  return withClient(async (client) => {
    const { rows } = await client.query<DraftSummary>(
      `SELECT ${DRAFT_COLUMNS}, jsonb_array_length(entries) AS "entryCount" FROM web_drafts
       ORDER BY updated_at DESC`,
    );
    return rows;
  });
}

export function create(input: DraftInput): Promise<Draft> {
  return withClient(async (client) => {
    const valid = await validate(client, input, new Set());
    const { rows } = await client.query<Draft>(
      `INSERT INTO web_drafts (name, author, entries) VALUES ($1, $2, $3)
       RETURNING ${DRAFT_COLUMNS}, entries`,
      [valid.name, valid.author, JSON.stringify(valid.entries)],
    );
    return rows[0];
  });
}

/** The draft, or null when there is none by that id. */
export function find(id: string): Promise<Draft | null> {
  return withClient((client) => load(client, draftId(id)));
}

export async function get(id: string): Promise<Draft> {
  const draft = await find(id);
  if (!draft) throw notFound();
  return draft;
}

export function update(id: string, input: DraftInput): Promise<Draft> {
  draftId(id);
  return withClient(async (client) => {
    const current = await load(client, id);
    if (!current) throw notFound();
    const valid = await validate(client, input, new Set(current.entries.map((e) => e.fingerprint)));
    const { rows } = await client.query<Draft>(
      `UPDATE web_drafts SET name = $2, author = $3, entries = $4, updated_at = now()
       WHERE id = $1
       RETURNING ${DRAFT_COLUMNS}, entries`,
      [id, valid.name, valid.author, JSON.stringify(valid.entries)],
    );
    if (rows.length === 0) throw notFound();
    return rows[0];
  });
}

export function remove(id: string): Promise<void> {
  draftId(id);
  return withClient(async (client) => {
    const { rowCount } = await client.query("DELETE FROM web_drafts WHERE id = $1", [id]);
    if (!rowCount) throw notFound();
  });
}

/** The name a draft's file is downloaded under, without the extension. */
export function stem(name: string): string {
  return [...name].map((c) => (/^[A-Za-z0-9 ._-]$/.test(c) ? c : "_")).join("");
}

/** The draft as the file the app's import reads. */
export async function file(id: string): Promise<Response> {
  const draft = await get(id);
  const body = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: draft.name,
    entries: draft.entries,
  };
  return Response.json(body, {
    headers: { "content-disposition": `attachment; filename="${stem(draft.name)}.json"` },
  });
}
