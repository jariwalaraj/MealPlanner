# WhatsApp Menu Bot (personal)

Save your menu items over WhatsApp and get meal suggestions or a 7-day plan.

## Commands
| Message | What it does |
|---|---|
| `add dal tadka #veg #quick, pasta #veg` | Save items with optional tags (comma or new-line separated) |
| `tag pasta #italian #kids` | Add tags to an existing item (also: `tag pasta: italian, kids`) |
| `untag pasta #kids` | Remove tags from an item |
| `remove pasta` | Delete an item (and its tags) |
| `menu` / `menu veg` | List items, optionally only those with all given tags |
| `tags` | List your tags with item counts |
| `suggest` / `suggest veg quick` | One meal idea, optionally filtered by tags (avoids repeats within `SUGGEST_COOLDOWN_DAYS`) |
| `week` / `week veg` | 7-day plan, optionally filtered by tags |
| `clear` | Delete everything |
| `help` | Show commands |

Tags are case-insensitive. When you filter by several tags, an item must have all of them.

## Database schema
```sql
CREATE TABLE menu_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone     TEXT NOT NULL,
  name           TEXT NOT NULL COLLATE NOCASE,
  last_suggested INTEGER,              -- unix ms, null = never suggested
  created_at     INTEGER NOT NULL,
  UNIQUE (user_phone, name)
);

CREATE TABLE item_tags (
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX idx_item_tags_tag ON item_tags(tag);
```
Tables are created automatically on startup, so an existing `menu.db` picks up `item_tags` with no manual migration.

## 1. Run locally
```bash
npm install
cp .env.example .env   # fill in the values
npm run dev
```
Expose it to the internet for testing, e.g. `npx localtunnel --port 3000` or `ngrok http 3000`.

## 2. Set up WhatsApp (Meta)
1. Go to developers.facebook.com → **Create app** → type **Business** → add the **WhatsApp** product.
2. Under **WhatsApp → API Setup**, copy the **temporary access token** and **Phone number ID** into `.env`.
3. Add your own number as a **recipient** on that page and verify it with the code Meta sends.
4. Under **WhatsApp → Configuration → Webhook**: set the callback URL to `https://<your-url>/webhook`
   and the verify token to your `VERIFY_TOKEN`. Then **subscribe** to the `messages` field.
5. Copy **App settings → Basic → App secret** into `APP_SECRET`.
6. Message the test number from your phone: `help`.

The temporary token expires after ~24h. For long-term use, create a **System User** in
Meta Business Settings and generate a permanent token with `whatsapp_business_messaging` permission.

## 3. Deploy
Any Node host works (Render, Railway, Fly.io). Set the same env vars there.
SQLite needs a persistent disk; on hosts without one, mount a volume or swap `db.js` for Postgres/Supabase.

## Files
- `src/index.js`: Express server, webhook verification, signature check
- `src/commands.js`: Command parsing and replies
- `src/suggest.js`: Suggestion and weekly plan logic
- `src/db.js`: SQLite storage
- `src/whatsapp.js`: Sends replies through the Cloud API
