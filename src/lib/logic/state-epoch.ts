// Memoization for the helpers that rebuild something from the tracker state on
// every call - the inventory, the unplaced items, the seed's options.
//
// They are called hundreds of times per analysis (every reachability question
// asks for the inventory and the options again), and in the analysis worker
// the state cannot change while a job runs: it only moves when the next job
// pours a new copy in. So the worker opens a new epoch per job and these
// answer from the first call of that epoch.
//
// In the window there are no epochs - state changes the moment anything is
// clicked, with nothing to say so - and every call computes afresh, exactly as
// before.
let epoch: number | null = null;

/** The worker calls this each time it takes in a new copy of the state. */
export function beginStateEpoch(): void {
  epoch = (epoch ?? 0) + 1;
}

/** Wraps a function of the tracker state alone, with no arguments. */
export function memoizeOnStateEpoch<T>(compute: () => T): () => T {
  let cachedEpoch: number | null = null;
  let cached: T;
  return () => {
    if (epoch === null) return compute();
    if (cachedEpoch !== epoch) {
      cached = compute();
      cachedEpoch = epoch;
    }
    return cached;
  };
}

/**
 * The same for a function of the state and one argument, remembered per
 * argument - by the argument itself, or by what `keyOf` makes of it.
 */
export function memoizeOnStateEpochBy<A, T>(compute: (argument: A) => T, keyOf: (argument: A) => unknown = (argument) => argument): (argument: A) => T {
  let cachedEpoch: number | null = null;
  const cached = new Map<unknown, T>();
  return (argument: A) => {
    if (epoch === null) return compute(argument);
    if (cachedEpoch !== epoch) {
      cached.clear();
      cachedEpoch = epoch;
    }
    const key = keyOf(argument);
    if (!cached.has(key)) cached.set(key, compute(argument));
    return cached.get(key)!;
  };
}
