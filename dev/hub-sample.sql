-- Local runs only (compose.yaml): the hub as an owner would leave it, so the
-- page has something to search without a RadiodioDJ install publishing to it.
-- The table is the app's (`src-tauri/src/hub/schema.rs`); the fingerprints
-- are made up, so nothing here binds to a real audio file.

CREATE SEQUENCE IF NOT EXISTS hub_rev;

CREATE TABLE IF NOT EXISTS hub_rows (
  kind      text    NOT NULL,
  key       text    NOT NULL,
  rev       bigint  NOT NULL,
  machine   text    NOT NULL,
  edited_at bigint  NOT NULL,
  deleted   boolean NOT NULL DEFAULT false,
  doc       jsonb,
  waveform  bytea,
  levels    bytea,
  PRIMARY KEY (kind, key)
);
CREATE INDEX IF NOT EXISTS hub_rows_rev ON hub_rows (rev);

-- The cases the app's docs/library-search.md measures search against, and a
-- few for punctuation and compilations.
INSERT INTO hub_rows (kind, key, rev, machine, edited_at, doc)
SELECT 'track', n::text, nextval('hub_rev'), 'sample', 0,
       jsonb_build_object(
         'title', t.title, 'artist', t.artist, 'album', t.album,
         'album_artist', t.album_artist, 'genre', t.genre,
         'duration', 180 + n * 7, 'content_type', 'music',
         'fingerprint', 'v2:' || encode(sha256(('sample ' || n)::bytea), 'hex'),
         'missing_since', NULL)
FROM (VALUES
  (1, 'Autobahn', 'Kraftwerk', 'Autobahn', 'Kraftwerk', 'Electronic'),
  (2, 'Jóga', 'Björk', 'Homogenic', 'Björk', 'Electronic'),
  (3, 'Łódź', 'Marek Biliński', 'Dziecko Słońca', 'Marek Biliński', 'Electronic'),
  (4, 'Come Together', 'The Beatles', 'Abbey Road', 'The Beatles', 'Rock'),
  (5, 'Thunderstruck', 'AC/DC', 'The Razors Edge', 'AC/DC', 'Rock'),
  (6, 'Blue Monday', 'New Order', 'Now That''s What I Call the 80s', 'Various Artists', 'Pop'),
  (7, 'Sweet Dreams', 'Eurythmics', 'Now That''s What I Call the 80s', 'Various Artists', 'Pop'),
  (8, 'Säkkijärven polkka', 'Viljo Vesterinen', 'Suomalaisia klassikoita', 'Various Artists', 'Folk')
) AS t(n, title, artist, album, album_artist, genre);

-- Bulk, with the rows the catalogue has to leave out: a tenth missing, a
-- tenth not fingerprinted yet, and a purged track's tombstone.
INSERT INTO hub_rows (kind, key, rev, machine, edited_at, deleted, doc)
SELECT 'track', n::text, nextval('hub_rev'), 'sample', 0, n % 97 = 0,
       CASE WHEN n % 97 = 0 THEN NULL ELSE jsonb_build_object(
         'title', 'Track ' || n, 'artist', 'Artist ' || (n % 40), 'album', 'Album ' || (n % 120),
         'album_artist', 'Artist ' || (n % 40),
         'genre', (ARRAY['Rock', 'Pop', 'Jazz', 'Hip-Hop', 'Jingle'])[1 + n % 5],
         'duration', 120 + (n % 240),
         'content_type', CASE WHEN n % 5 = 4 THEN 'jingle' ELSE 'music' END,
         'fingerprint', CASE WHEN n % 10 = 3 THEN NULL
                             ELSE 'v2:' || encode(sha256(('sample ' || n)::bytea), 'hex') END,
         'missing_since', CASE WHEN n % 10 = 7 THEN 1700000000 END) END
FROM generate_series(100, 600) AS n;

INSERT INTO hub_rows (kind, key, rev, machine, edited_at, doc)
VALUES ('root', '1', nextval('hub_rev'), 'sample', 0, '{"content_type": "music"}');
