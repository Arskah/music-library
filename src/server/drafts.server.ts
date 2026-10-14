import type pg from "pg";

import { badRequest, notFound, unprocessable } from "../errors.ts";
import { draftId, type Draft, type DraftInput, type DraftSummary, type Entry } from "../schema.ts";
import { catalogue, withClient } from "./db.server.ts";

/** The saved playlist file the app imports (`docs/saved-playlists.md`, "The file"). */
const FILE_FORMAT = "radiodiodj-playlist";
const FILE_VERSION = 1;

const TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
const DRAFT_COLUMNS = `id, name, author,
  to_char(created_at AT TIME ZONE 'UTC', ${TIMESTAMP}) AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', ${TIMESTAMP}) AS "updatedAt"`;

/** Checks a draft id from a path before Postgres sees it. */
function checkId(id: string): string {
  const parsed = draftId.safeParse(id);
  if (!parsed.success) throw badRequest(parsed.error.issues[0].message);
  return parsed.data;
}

/** Refuses an entry whose fingerprint is not in the catalogue: one the app
 * cannot bind is the one thing the page must not hand back. `kept` is the
 * fingerprints the draft already holds, which stay valid after their track
 * leaves the catalogue. */
async function checkFingerprints(client: pg.PoolClient, entries: Entry[], kept: Set<string>) {
  const fresh = [...new Set(entries.map((e) => e.fingerprint))].filter((f) => !kept.has(f));
  if (fresh.length === 0) return;
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
    await checkFingerprints(client, input.entries, new Set());
    const { rows } = await client.query<Draft>(
      `INSERT INTO web_drafts (name, author, entries) VALUES ($1, $2, $3)
       RETURNING ${DRAFT_COLUMNS}, entries`,
      [input.name, input.author, JSON.stringify(input.entries)],
    );
    return rows[0];
  });
}

/** The draft, or null when there is none by that id. */
export function find(id: string): Promise<Draft | null> {
  return withClient((client) => load(client, checkId(id)));
}

export async function get(id: string): Promise<Draft> {
  const draft = await find(id);
  if (!draft) throw notFound();
  return draft;
}

export function update(id: string, input: DraftInput): Promise<Draft> {
  checkId(id);
  return withClient(async (client) => {
    const current = await load(client, id);
    if (!current) throw notFound();
    await checkFingerprints(client, input.entries, new Set(current.entries.map((e) => e.fingerprint)));
    const { rows } = await client.query<Draft>(
      `UPDATE web_drafts SET name = $2, author = $3, entries = $4, updated_at = now()
       WHERE id = $1
       RETURNING ${DRAFT_COLUMNS}, entries`,
      [id, input.name, input.author, JSON.stringify(input.entries)],
    );
    if (rows.length === 0) throw notFound();
    return rows[0];
  });
}

export function remove(id: string): Promise<void> {
  checkId(id);
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
