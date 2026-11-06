const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick one item, preferring ones not suggested within the cooldown window. */
export function pickOne(items, cooldownDays = 3) {
  if (items.length === 0) return null;
  const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
  const fresh = items.filter((i) => !i.last_suggested || i.last_suggested < cutoff);
  if (fresh.length > 0) return fresh[Math.floor(Math.random() * fresh.length)];
  // Everything was suggested recently: fall back to the least recently suggested
  return [...items].sort((a, b) => a.last_suggested - b.last_suggested)[0];
}

/** Build a 7-day plan. No repeats if you have 7+ items; otherwise no same item two days in a row. */
export function buildWeek(items) {
  if (items.length === 0) return [];
  // Prefer items that haven't been suggested for longest, then shuffle within that order
  const pool = [];
  while (pool.length < DAYS.length) {
    let batch = shuffle(items);
    // Avoid the same item on two consecutive days across batch boundaries
    if (pool.length && items.length > 1 && batch[0].id === pool[pool.length - 1].id) {
      batch.push(batch.shift());
    }
    pool.push(...batch);
  }
  return DAYS.map((day, i) => ({ day, item: pool[i] }));
}
