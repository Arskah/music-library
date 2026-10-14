import { describe, expect, it } from "vitest";

import { draftInput } from "../schema.ts";
import { stem } from "./drafts.server.ts";
import { tokens } from "./search.server.ts";

describe("tokens", () => {
  it("splits where FTS5's unicode61 would", () => {
    expect(tokens("AC/DC  Björk")).toEqual(["ac", "dc", "björk"]);
    expect(tokens(" -- ")).toEqual([]);
  });

  it("keeps at most sixteen words", () => {
    expect(tokens(Array(20).fill("a").join(" "))).toHaveLength(16);
  });
});

describe("draftInput", () => {
  it("keeps exactly the file's entry keys", () => {
    expect(
      draftInput.parse({ name: "n", author: "a", entries: [{ fingerprint: "f", title: "t", extra: 1 }] }),
    ).toEqual({
      name: "n",
      author: "a",
      entries: [{ fingerprint: "f", artist: null, title: "t", duration: null, contentType: null }],
    });
  });

  it("trims, and refuses what the app could not import", () => {
    expect(draftInput.parse({ name: " n ", author: "a" }).name).toBe("n");
    expect(() => draftInput.parse({ name: "  ", author: "a" })).toThrow("name must be 1 to 200");
    expect(() => draftInput.parse({ name: "n", author: "a".repeat(201) })).toThrow("author");
    const entry = (e: object) => ({ name: "n", author: "a", entries: [{ fingerprint: "f", ...e }] });
    expect(() => draftInput.parse(entry({ contentType: "talk" }))).toThrow();
    expect(() => draftInput.parse(entry({ duration: -1 }))).toThrow("duration must be 0 or more");
    expect(() => draftInput.parse(entry({ duration: Infinity }))).toThrow();
  });

  it("refuses the wrong shape", () => {
    expect(() => draftInput.parse({ name: 1, author: "a" })).toThrow();
    expect(() => draftInput.parse({ name: "n", author: "a", entries: [{}] })).toThrow();
    expect(() => draftInput.parse([])).toThrow();
  });
});

describe("stem", () => {
  it("keeps what is safe in a file name", () => {
    expect(stem("Mix/1: Friday.v2")).toBe("Mix_1_ Friday.v2");
    expect(stem("Säkki 🎵")).toBe("S_kki _");
  });
});
