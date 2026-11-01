import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRaceDelay } from "./race-delay";

describe("createRaceDelay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setUp(delays: Record<number, number>) {
    const applied: string[] = [];
    const delay = createRaceDelay<string>({
      delayOf: (slot) => (delays[slot] ?? 0) * 1000,
      apply: (slot, update) => applied.push(`${slot}:${update}`)
    });
    return { applied, delay };
  }

  it("lets an update through once the runner's delay has passed", () => {
    const { applied, delay } = setUp({ 1: 10 });
    delay.push(1, "bow");
    vi.advanceTimersByTime(9000);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(applied).toEqual(["1:bow"]);
  });

  it("holds each runner back by their own delay", () => {
    const { applied, delay } = setUp({ 1: 5 });
    delay.push(1, "bow");
    delay.push(2, "hookshot");
    expect(applied).toEqual(["2:hookshot"]);
    vi.advanceTimersByTime(5000);
    expect(applied).toEqual(["2:hookshot", "1:bow"]);
  });

  it("never lets an update through ahead of an older one", () => {
    const { applied, delay } = setUp({ 1: 5 });
    delay.push(1, "bow");
    delay.push(1, "tracked for", { delayed: false });
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(5000);
    expect(applied).toEqual(["1:bow", "1:tracked for"]);
  });

  it("counts from when an update reached the tracker", () => {
    const { applied, delay } = setUp({ 1: 30 });
    delay.push(1, "snapshot", { at: Date.now() - 25_000 });
    vi.advanceTimersByTime(4000);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(applied).toEqual(["1:snapshot"]);
  });

  it("takes a shortened delay within a second", () => {
    const delays = { 1: 60 };
    const { applied, delay } = setUp(delays);
    delay.push(1, "bow");
    vi.advanceTimersByTime(2000);
    delays[1] = 1;
    vi.advanceTimersByTime(1000);
    expect(applied).toEqual(["1:bow"]);
  });

  it("lets a runner's updates through at once when flushed, and drops them when cleared", () => {
    const { applied, delay } = setUp({ 1: 30, 2: 30 });
    delay.push(1, "bow");
    delay.push(2, "hookshot");
    delay.flush(1);
    expect(applied).toEqual(["1:bow"]);
    delay.clear();
    vi.advanceTimersByTime(60_000);
    expect(applied).toEqual(["1:bow"]);
  });
});
