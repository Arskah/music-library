-- The catalogue the page searches, read straight from what the owner
-- publishes: every `track` document in `hub_rows` that carries a fingerprint.
-- Applied once `hub_rows` exists, which is the owner's table to create.
--
-- This ties the page to the document's key names, which are the app's `tracks`
-- column names. `hidden_at` is not one of them: hiding travels as a group of
-- its own that no build publishes yet, so a hidden track is still listed.

CREATE INDEX IF NOT EXISTS hub_rows_track_search ON hub_rows
  USING gin (track_search(doc)) WHERE kind = 'track' AND NOT deleted;
CREATE INDEX IF NOT EXISTS hub_rows_track_fingerprint ON hub_rows
  ((doc->>'fingerprint')) WHERE kind = 'track' AND NOT deleted;

CREATE OR REPLACE VIEW hub_catalogue AS
SELECT key::bigint                          AS track_id,
       doc->>'fingerprint'                  AS fingerprint,
       doc->>'title'                        AS title,
       doc->>'artist'                       AS artist,
       doc->>'album'                        AS album,
       doc->>'album_artist'                 AS album_artist,
       doc->>'genre'                        AS genre,
       (doc->>'duration')::double precision AS duration,
       doc->>'content_type'                 AS content_type,
       doc->>'missing_since' IS NOT NULL    AS missing,
       track_search(doc)                    AS search,
       track_text(doc)                      AS search_text
FROM hub_rows
WHERE kind = 'track' AND NOT deleted AND doc->>'fingerprint' IS NOT NULL;
