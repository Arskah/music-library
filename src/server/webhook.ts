import { createHmac, timingSafeEqual } from "node:crypto";

import { ApiError, badRequest } from "./errors.ts";

/** The app's `X-{APP_NAME}-Signature` (`docs/now-playing-broadcast.md`). */
export const SIGNATURE = "x-radiodiodj-signature";
const SCHEME = "sha256=";

/** The events are a few hundred bytes. The cap is on a body that is read
 * whole before anything has vouched for its sender. */
export const MAX_BODY = 64 * 1024;

/** The event's track without its `id` and `path`, which are the studio
 * machine's own and mean nothing here. */
export type Track = {
  title: string;
  artist: string;
  album: string;
  genre: string | null;
  durationSec: number;
  contentType: string;
};

/** What the app's now-playing webhook sends. */
export type Event =
  | { event: "now_playing"; track: Track; startedAt: string }
  | { event: "stopped"; stoppedAt: string }
  | { event: "test"; sentAt: string };

/** The secret the app signs with, or null when the endpoint is off. Without
 * one there is nothing to tell the app from anyone else. */
export function secret(): string | null {
  return process.env.WEBHOOK_SECRET?.trim() || null;
}

/** The last `now_playing` or `stopped`, kept in memory: a restart forgets it
 * until the next track starts. */
let last: Event | null = null;

/** Whether `header` is `sha256=` and the hex of HMAC-SHA256 over the body as
 * it arrived. The comparison is in constant time. */
export function signed(secret: string, body: Uint8Array, header: string): boolean {
  if (!header.startsWith(SCHEME)) return false;
  const hex = header.slice(SCHEME.length);
  if (hex === "" || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) return false;
  const given = Buffer.from(hex, "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field}: expected a string`);
  return value;
}

/** Reads one of the app's events, keeping only the fields this page uses. */
export function parseEvent(text: string): Event {
  const raw = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) throw new Error("expected an object");
  switch (raw.event) {
    case "now_playing": {
      const t = raw.track;
      if (typeof t !== "object" || t === null) throw new Error("track: expected an object");
      if (typeof t.durationSec !== "number") throw new Error("durationSec: expected a number");
      if (t.genre != null && typeof t.genre !== "string") throw new Error("genre: expected a string");
      return {
        event: "now_playing",
        track: {
          title: string(t.title, "title"),
          artist: string(t.artist, "artist"),
          album: string(t.album, "album"),
          genre: t.genre ?? null,
          durationSec: t.durationSec,
          contentType: string(t.contentType, "contentType"),
        },
        startedAt: string(raw.startedAt, "startedAt"),
      };
    }
    case "stopped":
      return { event: "stopped", stoppedAt: string(raw.stoppedAt, "stoppedAt") };
    case "test":
      return { event: "test", sentAt: string(raw.sentAt, "sentAt") };
    default:
      throw new Error(`unknown event ${JSON.stringify(raw.event)}`);
  }
}

/** The body as it was sent, refused once it passes `MAX_BODY`. */
async function readBody(request: Request): Promise<Uint8Array> {
  const tooLarge = () => new ApiError(413, "body too large");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > MAX_BODY) throw tooLarge();
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}

/** Takes the bytes rather than parsed JSON: the signature is over the body as
 * sent, and nothing is parsed before it has been checked. */
export async function receive(secret: string, request: Request): Promise<Response> {
  const body = await readBody(request);
  const header = request.headers.get(SIGNATURE);
  if (header === null || !signed(secret, body, header)) {
    throw new ApiError(401, "unauthorized");
  }

  let event: Event;
  try {
    event = parseEvent(new TextDecoder().decode(body));
  } catch (e) {
    throw badRequest(`not a now-playing event: ${(e as Error).message}`);
  }
  if (event.event === "test") {
    console.info("webhook: test event");
  } else {
    last = event;
  }
  return new Response(null, { status: 204 });
}

/** The last `now_playing` or `stopped`, or `null` before the first. The app
 * cannot send a `stopped` when it crashes, so `startedAt` and `durationSec`
 * are what tell a track that should have ended. */
export function nowPlaying(): Event | null {
  return last;
}
