import { createClient } from '@libsql/client';

// Turso in production; falls back to a local SQLite file for development.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:menu.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await db.executeMultiple(`
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

/** libSQL rows are array-like; turn a result set into plain { column: value } objects. */
const objects = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

/**
 * entries: [{ name, tags: [] }]
 * New items are created; tags are added to new and existing items alike.
 */
export async function addItems(phone, entries) {
  const now = Date.now();
  const stmts = [];
  const insertIdx = [];
  for (const { name, tags } of entries) {
    insertIdx.push(stmts.length);
    stmts.push({
      sql: 'INSERT OR IGNORE INTO menu_items (user_phone, name, created_at) VALUES (?, ?, ?)',
      args: [phone, name, now],
    });
    for (const tag of tags) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO item_tags (item_id, tag)
              SELECT id, ? FROM menu_items WHERE user_phone = ? AND name = ?`,
        args: [tag, phone, name],
      });
    }
  }
  const results = await db.batch(stmts, 'write');
  const added = [];
  const existing = [];
  entries.forEach(({ name }, i) => {
    (results[insertIdx[i]].rowsAffected ? added : existing).push(name);
  });
  return { added, existing };
}

export async function findItem(phone, name) {
  const rs = await db.execute({
    sql: 'SELECT id, name FROM menu_items WHERE user_phone = ? AND name = ?',
    args: [phone, name],
  });
  return objects(rs)[0] || null;
}

export async function addTags(itemId, tags) {
  if (!tags.length) return;
  await db.batch(
    tags.map((tag) => ({ sql: 'INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)', args: [itemId, tag] })),
    'write'
  );
}

export async function removeTags(itemId, tags) {
  if (!tags.length) return 0;
  const results = await db.batch(
    tags.map((tag) => ({ sql: 'DELETE FROM item_tags WHERE item_id = ? AND tag = ?', args: [itemId, tag] })),
    'write'
  );
  return results.reduce((n, r) => n + r.rowsAffected, 0);
}

// Tags are deleted explicitly: foreign_keys (and so ON DELETE CASCADE) isn't guaranteed on remote connections.
export async function removeItem(phone, name) {
  const [, res] = await db.batch([
    {
      sql: 'DELETE FROM item_tags WHERE item_id IN (SELECT id FROM menu_items WHERE user_phone = ? AND name = ?)',
      args: [phone, name],
    },
    { sql: 'DELETE FROM menu_items WHERE user_phone = ? AND name = ?', args: [phone, name] },
  ], 'write');
  return res.rowsAffected > 0;
}

export async function clearItems(phone) {
  const [, res] = await db.batch([
    { sql: 'DELETE FROM item_tags WHERE item_id IN (SELECT id FROM menu_items WHERE user_phone = ?)', args: [phone] },
    { sql: 'DELETE FROM menu_items WHERE user_phone = ?', args: [phone] },
  ], 'write');
  return res.rowsAffected;
}

/** Returns [{ id, name, last_suggested, tags: ['veg', 'quick'] }] */
export async function listItems(phone) {
  const rs = await db.execute({
    sql: `
      SELECT i.id, i.name, i.last_suggested, group_concat(t.tag, ',') AS tags
      FROM menu_items i
      LEFT JOIN item_tags t ON t.item_id = i.id
      WHERE i.user_phone = ?
      GROUP BY i.id
      ORDER BY i.name`,
    args: [phone],
  });
  return objects(rs).map((row) => ({
    ...row,
    tags: row.tags ? String(row.tags).split(',').sort() : [],
  }));
}

export async function tagCounts(phone) {
  const rs = await db.execute({
    sql: `
      SELECT t.tag, count(*) AS count
      FROM item_tags t JOIN menu_items i ON i.id = t.item_id
      WHERE i.user_phone = ?
      GROUP BY t.tag
      ORDER BY count DESC, t.tag`,
    args: [phone],
  });
  return objects(rs);
}

export async function markSuggested(ids, when = Date.now()) {
  if (!ids.length) return;
  await db.batch(
    ids.map((id) => ({ sql: 'UPDATE menu_items SET last_suggested = ? WHERE id = ?', args: [when, id] })),
    'write'
  );
}
