import { describe, expect, it } from "vitest";
import { createId } from "./ids";

describe("createId", () => {
  it("creates collision-resistant ids for runtime prefixes", () => {
    const ids = Array.from({ length: 20 }, () => createId("company_event"));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^company_event_[0-9a-f-]{36}$/.test(id))).toBe(true);
  });

  it("rejects invalid prefixes", () => {
    expect(() => createId("9company")).toThrow("Invalid id prefix");
    expect(() => createId("company event")).toThrow("Invalid id prefix");
  });
});
