import type { Results, SearchInput, Track } from "../schema.ts";
import { catalogue, withClient } from "./db.server.ts";

/** The app's own cap (`Db::search`). */
const LIMIT = 200;
/** The loose pass runs only when the exact one found fewer than this. */
const LOOSE_BELOW = 10;
/** Low enough for one transposition in a nine-letter word (`kraftwrek`). */
const LOOSE_SIMILARITY = 0.45;
const MAX_TOKENS = 16;

const COLUMNS = `c.track_id AS "trackId", c.fingerprint, c.title, c.artist, c.album,
                 c.album_artist AS "albumArtist", c.genre, c.duration,
                 c.content_type AS "contentType"`;

/** Splits where FTS5's `unicode61` would, so `ac/dc` is two words here too. */
export function tokens(query: string): string[] {
  return query
    .split(/[^\p{Alphabetic}\p{N}]+/u)
    .filter((t) => t !== "")
    .slice(0, MAX_TOKENS)
    .map((t) => t.toLowerCase());
}

const tracks = (rows: Omit<Track, "loose">[], loose: boolean): Track[] =>
  rows.map((row) => ({ ...row, loose }));

export function search({ q, type }: SearchInput): Promise<Results> {
  const contentType = type ?? null;
  const words = tokens(q);

  return withClient(async (client) => {
    if (!(await catalogue(client))) {
      return { tracks: [], capped: false, published: false };
    }

    if (words.length === 0) {
      const { rows } = await client.query(
        `SELECT ${COLUMNS} FROM hub_catalogue c
         WHERE NOT c.missing AND ($1::text IS NULL OR c.content_type = $1)
         ORDER BY c.artist, c.album, c.title, c.track_id
         LIMIT $2`,
        [contentType, LIMIT],
      );
      return results(tracks(rows, false));
    }

    // Prefix-AND, order-free: the search the app's library panel runs.
    const prefixQuery = words.map((t) => `${t}:*`).join(" & ");
    const { rows } = await client.query(
      `SELECT ${COLUMNS}
       FROM hub_catalogue c, to_tsquery('simple', fold($1)) q
       WHERE NOT c.missing AND c.search @@ q
         AND ($2::text IS NULL OR c.content_type = $2)
       ORDER BY ts_rank(c.search, q) DESC, c.artist, c.album, c.title, c.track_id
       LIMIT $3`,
      [prefixQuery, contentType, LIMIT],
    );
    const found = tracks(rows, false);

    if (found.length < LOOSE_BELOW) {
      // Every word must still match something. A word of one or two letters
      // gets no slack, as in the app's planned edit budget.
      const { rows } = await client.query(
        String.raw`WITH toks AS (SELECT fold(t) AS t FROM unnest($1::text[]) AS t)
         SELECT ${COLUMNS}
         FROM hub_catalogue c
         WHERE NOT c.missing
           AND ($2::text IS NULL OR c.content_type = $2)
           AND c.track_id <> ALL($3::bigint[])
           AND NOT EXISTS (
             SELECT 1 FROM toks WHERE NOT CASE
               WHEN char_length(t) <= 2 THEN c.search_text ~ ('\m' || t)
               ELSE word_similarity(t, c.search_text) >= $4::real
             END)
         ORDER BY (SELECT sum(word_similarity(t, c.search_text)) FROM toks) DESC,
                  c.artist, c.album, c.title, c.track_id
         LIMIT $5`,
        [words, contentType, found.map((t) => t.trackId), LOOSE_SIMILARITY, LIMIT - found.length],
      );
      found.push(...tracks(rows, true));
    }

    return results(found);
  });
}

function results(tracks: Track[]): Results {
  return { tracks, capped: tracks.length >= LIMIT, published: true };
}
