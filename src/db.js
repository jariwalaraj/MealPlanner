import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_PATH || 'menu.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON'); // needed for ON DELETE CASCADE on item_tags

function transaction(fn) {
  return () => {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_phone     TEXT NOT NULL,
    name           TEXT NOT NULL COLLATE NOCASE,
    last_suggested INTEGER,              -- unix ms, null = never suggested
    created_at     INTEGER NOT NULL,
    UNIQUE (user_phone, name)
  );

  CREATE TABLE IF NOT EXISTS item_tags (
    item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (item_id, tag)
  );

  CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag);
`);

const insertItemStmt = db.prepare(
  'INSERT OR IGNORE INTO menu_items (user_phone, name, created_at) VALUES (?, ?, ?)'
);
const findItemStmt = db.prepare('SELECT id, name FROM menu_items WHERE user_phone = ? AND name = ?');
const removeStmt = db.prepare('DELETE FROM menu_items WHERE user_phone = ? AND name = ?');
const clearStmt = db.prepare('DELETE FROM menu_items WHERE user_phone = ?');
const listStmt = db.prepare(`
  SELECT i.id, i.name, i.last_suggested, group_concat(t.tag, ',') AS tags
  FROM menu_items i
  LEFT JOIN item_tags t ON t.item_id = i.id
  WHERE i.user_phone = ?
  GROUP BY i.id
  ORDER BY i.name
`);
const markStmt = db.prepare('UPDATE menu_items SET last_suggested = ? WHERE id = ?');
const addTagStmt = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)');
const removeTagStmt = db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag = ?');
const tagCountsStmt = db.prepare(`
  SELECT t.tag, count(*) AS count
  FROM item_tags t JOIN menu_items i ON i.id = t.item_id
  WHERE i.user_phone = ?
  GROUP BY t.tag
  ORDER BY count DESC, t.tag
`);

/**
 * entries: [{ name, tags: [] }]
 * New items are created; tags are added to new and existing items alike.
 */
export function addItems(phone, entries) {
  const added = [];
  const existing = [];
  const now = Date.now();
  transaction(() => {
    for (const { name, tags } of entries) {
      const res = insertItemStmt.run(phone, name, now);
      (res.changes ? added : existing).push(name);
      const item = findItemStmt.get(phone, name);
      for (const tag of tags) addTagStmt.run(item.id, tag);
    }
  })();
  return { added, existing };
}

export function findItem(phone, name) {
  return findItemStmt.get(phone, name) || null;
}

export function addTags(itemId, tags) {
  transaction(() => {
    for (const tag of tags) addTagStmt.run(itemId, tag);
  })();
}

export function removeTags(itemId, tags) {
  let removed = 0;
  transaction(() => {
    for (const tag of tags) removed += removeTagStmt.run(itemId, tag).changes;
  })();
  return removed;
}

export function removeItem(phone, name) {
  return removeStmt.run(phone, name).changes > 0;
}

export function clearItems(phone) {
  return clearStmt.run(phone).changes;
}

/** Returns [{ id, name, last_suggested, tags: ['veg', 'quick'] }] */
export function listItems(phone) {
  return listStmt.all(phone).map((row) => ({
    ...row,
    tags: row.tags ? row.tags.split(',').sort() : [],
  }));
}

export function tagCounts(phone) {
  return tagCountsStmt.all(phone);
}

export function markSuggested(ids, when = Date.now()) {
  transaction(() => {
    for (const id of ids) markStmt.run(when, id);
  })();
}
