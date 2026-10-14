// What the page reads and writes, as server functions. The REST routes under
// `routes/api` call the same code for everyone else.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { draftInput, searchInput } from "./schema.ts";
import * as drafts from "./server/drafts.server.ts";
import { search } from "./server/search.server.ts";
import { nowPlaying, secret } from "./server/webhook.server.ts";

export const searchTracks = createServerFn({ method: "GET" })
  .validator(searchInput)
  .handler(({ data }) => search(data));

export const listDrafts = createServerFn({ method: "GET" }).handler(() => drafts.list());

export const findDraft = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(({ data }) => drafts.find(data.id));

export const saveDraft = createServerFn({ method: "POST" })
  .validator(draftInput.extend({ id: z.string().optional() }))
  .handler(({ data: { id, ...input } }) => (id ? drafts.update(id, input) : drafts.create(input)));

export const deleteDraft = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(({ data }) => drafts.remove(data.id));

/** The last event, or `enabled: false` when there is no webhook and so never
 * anything to show. */
export const getNowPlaying = createServerFn({ method: "GET" }).handler(() => ({
  enabled: secret() !== null,
  event: nowPlaying(),
}));
