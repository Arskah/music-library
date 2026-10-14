import { describe, expect, it } from "vitest";

import { parseEvent, signed } from "./webhook.ts";

// The app's own regression value: HMAC-SHA256("hello", b"hi").
const HI = "sha256=42eb9553cf9288e53d3389208d00db1ac80d3666f1fa74fe02e1038672d0c83a";
const bytes = (s: string) => new TextEncoder().encode(s);

describe("signed", () => {
  it("accepts the app's signature", () => {
    expect(signed("hello", bytes("hi"), HI)).toBe(true);
  });

  it("rejects another secret, body or shape", () => {
    expect(signed("hullo", bytes("hi"), HI)).toBe(false);
    expect(signed("hello", bytes("ho"), HI)).toBe(false);
    expect(signed("hello", bytes("hi"), HI.slice("sha256=".length))).toBe(false);
    expect(signed("hello", bytes("hi"), HI.slice(0, -2))).toBe(false);
    expect(signed("hello", bytes("hi"), "sha256=")).toBe(false);
    expect(signed("hello", bytes("hi"), "sha256=zz")).toBe(false);
    expect(signed("hello", bytes("hi"), "sha256=é")).toBe(false);
  });
});

describe("parseEvent", () => {
  it("reads the app's events", () => {
    const event = parseEvent(
      `{"event":"now_playing","track":{"id":123,"title":"Song","artist":"Artist",
        "album":"Album","genre":null,"durationSec":245.3,"contentType":"music",
        "path":"/abs/path/file.mp3"},"startedAt":"2026-05-19T14:23:11.482Z"}`,
    );
    const out = JSON.stringify(event);
    expect(out).toContain(`"event":"now_playing"`);
    expect(out).toContain(`"startedAt":"2026-05-19T14:23:11.482Z"`);
    expect(out).toContain(`"durationSec":245.3`);
    expect(out).not.toContain("path");

    const stopped = `{"event":"stopped","stoppedAt":"2026-05-19T14:27:16.901Z"}`;
    expect(JSON.stringify(parseEvent(stopped))).toBe(stopped);
    expect(parseEvent(`{"event":"test","sentAt":"2026-05-19T00:00:00Z"}`).event).toBe("test");
    expect(() => parseEvent(`{"event":"other"}`)).toThrow();
  });

  it("refuses a track that is missing a field", () => {
    expect(() =>
      parseEvent(`{"event":"now_playing","track":{"title":"Song"},"startedAt":"x"}`),
    ).toThrow();
  });
});
