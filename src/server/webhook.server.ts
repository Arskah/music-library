import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { event as eventSchema, type Event } from "../schema.ts";
import { badRequest, tooLarge, unauthorized } from "../errors.ts";

/** The app's `X-{APP_NAME}-Signature` (`docs/now-playing-broadcast.md`). */
export const SIGNATURE = "x-radiodiodj-signature";
const SCHEME = "sha256=";

/** The events are a few hundred bytes. The cap is on a body that is read
 * whole before anything has vouched for its sender. */
export const MAX_BODY = 64 * 1024;

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

/** Reads one of the app's events, keeping only the fields this page uses. */
export function parseEvent(text: string): Event {
  return eventSchema.parse(JSON.parse(text));
}

/** The body as it was sent, refused once it passes `MAX_BODY`. */
async function readBody(request: Request): Promise<Uint8Array> {
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
    throw unauthorized();
  }

  let event: Event;
  try {
    event = parseEvent(new TextDecoder().decode(body));
  } catch (e) {
    const reason = e instanceof z.ZodError ? z.prettifyError(e) : String(e);
    throw badRequest(`not a now-playing event: ${reason}`);
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
