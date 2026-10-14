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
  duration: nullable(z.number().nonnegative("duration must be 0 or more")),
  contentType: nullable(contentType),
});
export type Entry = z.infer<typeof entry>;

const MAX_ENTRIES = 2000;
const MAX_NAME = 200;
const text = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} must be 1 to ${MAX_NAME} characters`)
    .max(MAX_NAME, `${field} must be 1 to ${MAX_NAME} characters`);

/** A draft as it is saved, trimmed. */
export const draftInput = z.object({
  name: text("name"),
  author: text("author"),
  entries: z.array(entry).max(MAX_ENTRIES, `a draft holds at most ${MAX_ENTRIES} entries`).default([]),
});
export type DraftInput = z.infer<typeof draftInput>;

export const draftId = z.uuid("invalid draft id");

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
