// Holding a runner's updates back for as long as their stream lags behind
// their game - the delay the host sets for each runner in the Race Tracking
// tab - so that nothing on stream, the browser sources or the host's tracker,
// shows an item before the runner's stream does.
//
// Each runner's updates wait in line, oldest first: an update is the whole of
// one store of the run, so one let through ahead of an older one would be
// undone by it.

// Checked at least this often while anything is held, so a delay changed
// meanwhile counts within a second.
const MAX_WAIT_MS = 1000;

export interface RaceDelay<T> {
  /**
   * An update from a runner, which reached this tracker at `at` - held back
   * by the runner's delay unless `delayed` is false, though never let
   * through ahead of an older one.
   */
  push(slot: number, update: T, options?: { at?: number; delayed?: boolean }): void;
  /** Lets through whatever is due by now. */
  release(): void;
  /** Lets through everything held for a runner now. */
  flush(slot: number): void;
  /** Drops everything held. */
  clear(): void;
}

interface Held<T> {
  at: number;
  delayed: boolean;
  update: T;
}

export function createRaceDelay<T>(options: {
  /** A runner's delay, in milliseconds - read again each time, so it can change while updates wait. */
  delayOf: (slot: number) => number;
  apply: (slot: number, update: T) => void;
}): RaceDelay<T> {
  const held = new Map<number, Held<T>[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function letThrough(slot: number, queue: Held<T>[], due: (entry: Held<T>) => boolean) {
    while (queue.length && due(queue[0])) {
      const { update } = queue.shift()!;
      try {
        options.apply(slot, update);
      } catch (error) {
        console.error("Race Tracking: could not apply a runner's update", error);
      }
    }
  }

  function release() {
    clearTimeout(timer);
    timer = undefined;
    const now = Date.now();
    let next = Infinity;
    held.forEach((queue, slot) => {
      const delay = Math.max(0, options.delayOf(slot));
      letThrough(slot, queue, (entry) => !entry.delayed || entry.at + delay <= now);
      if (queue.length) next = Math.min(next, queue[0].at + delay);
      else held.delete(slot);
    });
    if (next < Infinity) timer = setTimeout(release, Math.min(MAX_WAIT_MS, Math.max(0, next - now)));
  }

  return {
    push(slot, update, { at = Date.now(), delayed = true } = {}) {
      const queue = held.get(slot) ?? [];
      queue.push({ at, delayed, update });
      held.set(slot, queue);
      release();
    },
    release,
    flush(slot) {
      const queue = held.get(slot);
      if (queue) letThrough(slot, queue, () => true);
      release();
    },
    clear() {
      held.clear();
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
