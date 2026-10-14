import { queryOptions } from "@tanstack/react-query";

import { findDraft, getNowPlaying, listDrafts, searchTracks } from "./functions.ts";
import type { SearchInput } from "./schema.ts";

/** How often the page asks what is on air. */
const ON_AIR_EVERY = 10_000;

export const tracksQuery = (search: Partial<SearchInput>) =>
  queryOptions({
    queryKey: ["tracks", search],
    queryFn: () => searchTracks({ data: search }),
  });

export const draftsQuery = () =>
  queryOptions({
    queryKey: ["drafts"],
    queryFn: () => listDrafts(),
  });

/** The draft open in the page, or null for a new one. */
export const draftQuery = (id: string | undefined) =>
  queryOptions({
    queryKey: ["drafts", id ?? null],
    queryFn: () => (id ? findDraft({ data: { id } }) : null),
  });

export const nowPlayingQuery = () =>
  queryOptions({
    queryKey: ["now-playing"],
    queryFn: () => getNowPlaying(),
    // No webhook on this server: there will never be anything to show.
    refetchInterval: (query) => (query.state.data?.enabled === false ? false : ON_AIR_EVERY),
  });
