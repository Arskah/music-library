// The shapes the page and the server share. Nothing here may touch the
// database or a secret: the page's bundle imports it.
import { z } from "zod";

export const CONTENT_TYPES = ["music", "jingle", "commercial"] as const;
export const contentType = z.enum(CONTENT_TYPES);

/** A field the app may leave out or send as null, kept as null. */
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

/** One entry of the saved playlist file: no track id and no path. Unknown
 * keys are dropped, so an entry keeps exactly the file's own. */
export const entry = z.object({
  fingerprint: z.string(),
  artist: nullable(z.string()),
  title: nullable(z.string()),
  duration: nullable(z.number()),
  contentType: nullable(z.string()),
});
export type Entry = z.infer<typeof entry>;

export const draftInput = z.object({
  name: z.string(),
  author: z.string(),
  entries: z.array(entry).default([]),
});
export type DraftInput = z.infer<typeof draftInput>;

export type Draft = DraftInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type DraftSummary = Omit<Draft, "entries"> & { entryCount: number };

export const searchInput = z.object({
  q: z.string().default(""),
  type: contentType.optional(),
});
export type SearchInput = z.infer<typeof searchInput>;

export type Track = {
  trackId: number;
  fingerprint: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  genre: string | null;
  duration: number | null;
  contentType: string;
  /** Found by the loose pass, not by the words as typed. */
  loose: boolean;
};

export type Results = {
  tracks: Track[];
  capped: boolean;
  /** False until an owner has created the hub's tables. */
  published: boolean;
};

/** What the app's now-playing webhook sends. The track loses its `id` and
 * `path`, which are the studio machine's own and mean nothing here. */
export const event = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("now_playing"),
    track: z.object({
      title: z.string(),
      artist: z.string(),
      album: z.string(),
      genre: nullable(z.string()),
      durationSec: z.number(),
      contentType: z.string(),
    }),
    startedAt: z.string(),
  }),
  z.object({ event: z.literal("stopped"), stoppedAt: z.string() }),
  z.object({ event: z.literal("test"), sentAt: z.string() }),
]);
export type Event = z.infer<typeof event>;
