// Counts first uses ("Oppdaget 14 av N" on the mirror). Pure.
// The total can grow: add(keys) makes more first uses findable once they can be reached (a photographed thing whose
// model has arrived: scene/plantWiring.js), so the mirror never counts what a visitor cannot find. Listeners hear each
// new first use as (key, count, total) and a grown total as (null, count, total); a key it knows already changes nothing.

export function createDiscovery(keys) {
  const all = new Set(keys);
  const found = [];
  const listeners = [];

  function first(key) {
    if (!all.has(key)) throw new Error(`Unknown discovery "${key}"`);
    if (found.includes(key)) return false;
    found.push(key);
    for (const fn of listeners) fn(key, found.length, all.size);
    return true;
  }

  // returns how many keys were new
  function add(more) {
    let n = 0;
    for (const key of [].concat(more)) if (!all.has(key)) { all.add(key); n++; }
    if (n) for (const fn of listeners) fn(null, found.length, all.size);
    return n;
  }

  return {
    first,
    add,
    has: (key) => found.includes(key),
    count: () => found.length,
    total: () => all.size,
    found: () => found.slice(),
    onChange: (fn) => listeners.push(fn),
  };
}
