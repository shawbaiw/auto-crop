import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "./projectRoot";

describe("resolveProjectRoot", () => {
  it("uses INIT_CWD when pnpm starts the package from the workspace root", () => {
    expect(
      resolveProjectRoot({
        cwd: "/repo/apps/cli",
        env: { INIT_CWD: "/repo" },
      }),
    ).toBe("/repo");
  });

  it("falls back to cwd when INIT_CWD is not present", () => {
    expect(
      resolveProjectRoot({
        cwd: "/repo/apps/cli",
        env: {},
      }),
    ).toBe("/repo/apps/cli");
  });
});
