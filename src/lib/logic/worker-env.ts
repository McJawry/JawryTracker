// What the tracker's state modules expect of the page, for the analysis
// worker. They read their saved state from localStorage the moment they load,
// and a worker has none - so the worker gets an in-memory one, empty, before
// anything else is imported (sphere-worker.ts imports this first). The real
// state arrives with each job (sphere-worker-state.ts), so nothing read here
// ever matters, and nothing written here leaves the worker.
const store = new Map<string, string>();

if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    }
  };
}

export {};
