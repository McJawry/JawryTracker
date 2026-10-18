// The parsed logic - rules, macros and the world graph - is large, read
// constantly, and only ever replaced wholesale on a logic load, never edited in
// place. Stored on `data` as plain objects, Svelte deep-proxied them: every
// property the engine touched during a reachability pass went through a proxy
// trap, and inside a $derived each one was also recorded as a dependency -
// thousands of them, for objects that never change. The calculation ran half
// again as slowly on the proxied copy as on a plain one.
//
// Svelte only proxies objects whose prototype is Object.prototype or
// Array.prototype, so giving the top-level object a prototype of its own keeps
// it (and so everything under it) as it is. Reassigning the field on `data` is
// still reactive, which is the only change these ever see.
class RawTable {}

export function rawTable<T>(value: T): T {
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    Object.setPrototypeOf(value, RawTable.prototype);
  }
  return value;
}
