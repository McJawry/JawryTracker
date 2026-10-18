import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./release-check";

describe("isNewerVersion", () => {
  it("orders plain releases by number", () => {
    expect(isNewerVersion("v0.2.7", "0.2.6")).toBe(true);
    expect(isNewerVersion("v0.2.6", "0.2.6")).toBe(false);
    expect(isNewerVersion("v0.2.5", "0.2.6")).toBe(false);
    expect(isNewerVersion("v0.10.0", "0.9.9")).toBe(true);
  });

  it("puts a test version after the release before it", () => {
    expect(isNewerVersion("v0.2.7-beta.1", "0.2.6")).toBe(true);
    expect(isNewerVersion("v0.2.6", "0.2.7-beta.1")).toBe(false);
  });

  it("puts the finished release after its own test versions", () => {
    expect(isNewerVersion("v0.2.7", "0.2.7-beta.1")).toBe(true);
    expect(isNewerVersion("v0.2.7-beta.1", "0.2.7")).toBe(false);
  });

  it("orders test versions among themselves", () => {
    expect(isNewerVersion("v0.2.7-beta.2", "0.2.7-beta.1")).toBe(true);
    expect(isNewerVersion("v0.2.7-beta.10", "0.2.7-beta.9")).toBe(true);
    expect(isNewerVersion("v0.2.7-rc.1", "0.2.7-beta.5")).toBe(true);
    expect(isNewerVersion("v0.2.7-beta.1", "0.2.7-beta.1")).toBe(false);
    expect(isNewerVersion("v0.2.7-beta.1.1", "0.2.7-beta.1")).toBe(true);
    expect(isNewerVersion("v0.2.7-beta", "0.2.7-1")).toBe(true);
  });

  it("ignores build metadata", () => {
    expect(isNewerVersion("v0.2.7+abc", "0.2.7")).toBe(false);
  });
});
