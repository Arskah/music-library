CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() is only STABLE, which an index expression refuses. Naming the
-- dictionary makes the call safe to declare IMMUTABLE.
CREATE OR REPLACE FUNCTION fold(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent', $1)) $$;

-- Folded, with everything but letters and digits turned into spaces. Left to
-- itself the text search parser keeps `ac/dc` whole as a file path and
-- `example.com` as a host, and neither is then found by its words.
CREATE OR REPLACE FUNCTION words(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT regexp_replace(public.fold($1), '[^[:alnum:]]+', ' ', 'g') $$;

-- What a `track` document in `hub_rows` is searched by: the five columns the
-- app's own search covers, weighted title first. The functions name their
-- schema because an index is built with `public` off the search path.
CREATE OR REPLACE FUNCTION track_search(doc jsonb) RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT
    setweight(to_tsvector('simple', public.words(coalesce(doc->>'title', ''))), 'A') ||
    setweight(to_tsvector('simple', public.words(coalesce(doc->>'artist', ''))), 'B') ||
    setweight(to_tsvector('simple', public.words(coalesce(doc->>'album', '') || ' ' ||
                                          coalesce(doc->>'album_artist', ''))), 'C') ||
    setweight(to_tsvector('simple', public.words(coalesce(doc->>'genre', ''))), 'D') $$;

CREATE OR REPLACE FUNCTION track_text(doc jsonb) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.words(
    coalesce(doc->>'title', '') || ' ' || coalesce(doc->>'artist', '') || ' ' ||
    coalesce(doc->>'album', '') || ' ' || coalesce(doc->>'album_artist', '') || ' ' ||
    coalesce(doc->>'genre', '')) $$;

-- Up to 0.1 the catalogue was a table of this backend's own, filled with
-- made-up tracks. It is a view now (catalogue.sql).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class
             WHERE oid = to_regclass('hub_catalogue') AND relkind = 'r') THEN
    DROP TABLE hub_catalogue;
  END IF;
END $$;

-- A draft is a saved playlist file that has not been imported yet: `entries`
-- holds the file's own entry objects, in order.
CREATE TABLE IF NOT EXISTS web_drafts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  author     text NOT NULL,
  entries    jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
