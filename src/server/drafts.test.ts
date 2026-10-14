import { describe, expect, it } from "vitest";

import { parseInput, stem } from "./drafts.ts";
import { tokens } from "./search.ts";

describe("tokens", () => {
  it("splits where FTS5's unicode61 would", () => {
    expect(tokens("AC/DC  Björk")).toEqual(["ac", "dc", "björk"]);
    expect(tokens(" -- ")).toEqual([]);
  });

  it("keeps at most sixteen words", () => {
    expect(tokens(Array(20).fill("a").join(" "))).toHaveLength(16);
  });
});

describe("parseInput", () => {
  it("keeps exactly the file's entry keys", () => {
    expect(
      parseInput({ name: "n", author: "a", entries: [{ fingerprint: "f", title: "t", extra: 1 }] }),
    ).toEqual({
      name: "n",
      author: "a",
      entries: [{ fingerprint: "f", artist: null, title: "t", duration: null, contentType: null }],
    });
  });

  it("refuses the wrong shape", () => {
    expect(() => parseInput({ name: 1, author: "a" })).toThrow();
    expect(() => parseInput({ name: "n", author: "a", entries: [{}] })).toThrow();
    expect(() => parseInput([])).toThrow();
  });
});

describe("stem", () => {
  it("keeps what is safe in a file name", () => {
    expect(stem("Mix/1: Friday.v2")).toBe("Mix_1_ Friday.v2");
    expect(stem("Säkki 🎵")).toBe("S_kki _");
  });
});
