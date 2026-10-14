import type pg from "pg";

import { catalogue, withClient } from "./db.ts";
import { badRequest, notFound, unprocessable } from "./errors.ts";
import { CONTENT_TYPES } from "./search.ts";

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

/** One entry of the file: no track id and no path. */
export type Entry = {
  fingerprint: string;
  artist: string | null;
  title: string | null;
  duration: number | null;
  contentType: string | null;
};

export type DraftInput = {
  name: string;
  author: string;
  entries: Entry[];
};

export type Draft = {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  entries: Entry[];
};

export type DraftSummary = Omit<Draft, "entries"> & { entryCount: number };

function optional<T>(value: unknown, field: string, check: (v: unknown) => v is T): T | null {
  if (value === undefined || value === null) return null;
  if (!check(value)) throw unprocessable(`${field}: invalid type`);
  return value;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number";

/** The request body as a draft, or a 422 for one of the wrong shape. Unknown
 * keys are dropped, and an entry keeps exactly the file's own keys. */
export function parseInput(body: unknown): DraftInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw unprocessable("expected a JSON object");
  }
  const { name, author, entries } = body as Record<string, unknown>;
  if (!isString(name)) throw unprocessable("name: expected a string");
  if (!isString(author)) throw unprocessable("author: expected a string");
  if (entries !== undefined && !Array.isArray(entries)) {
    throw unprocessable("entries: expected an array");
  }
  return {
    name,
    author,
    entries: (entries ?? []).map((entry: unknown, i: number): Entry => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw unprocessable(`entries[${i}]: expected an object`);
      }
      const e = entry as Record<string, unknown>;
      if (!isString(e.fingerprint)) throw unprocessable(`entries[${i}].fingerprint: expected a string`);
      return {
        fingerprint: e.fingerprint,
        artist: optional(e.artist, `entries[${i}].artist`, isString),
        title: optional(e.title, `entries[${i}].title`, isString),
        duration: optional(e.duration, `entries[${i}].duration`, isNumber),
        contentType: optional(e.contentType, `entries[${i}].contentType`, isString),
      };
    }),
  };
}

/** Checks a draft id from the path before Postgres sees it. */
export function draftId(id: string): string {
  if (!UUID.test(id)) throw badRequest("invalid draft id");
  return id;
}

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
    if (entry.contentType !== null && !CONTENT_TYPES.includes(entry.contentType)) {
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

async function load(client: pg.PoolClient, id: string): Promise<Draft> {
  const { rows } = await client.query<Draft>(
    `SELECT ${DRAFT_COLUMNS}, entries FROM web_drafts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw notFound();
  return rows[0];
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

export function create(body: unknown): Promise<Draft> {
  const parsed = parseInput(body);
  return withClient(async (client) => {
    const input = await validate(client, parsed, new Set());
    const { rows } = await client.query<Draft>(
      `INSERT INTO web_drafts (name, author, entries) VALUES ($1, $2, $3)
       RETURNING ${DRAFT_COLUMNS}, entries`,
      [input.name, input.author, JSON.stringify(input.entries)],
    );
    return rows[0];
  });
}

export function get(id: string): Promise<Draft> {
  return withClient((client) => load(client, draftId(id)));
}

export function update(id: string, body: unknown): Promise<Draft> {
  draftId(id);
  const parsed = parseInput(body);
  return withClient(async (client) => {
    const kept = new Set((await load(client, id)).entries.map((e) => e.fingerprint));
    const input = await validate(client, parsed, kept);
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
