import {
  addItems, findItem, addTags, removeTags, removeItem, clearItems,
  listItems, tagCounts, markSuggested,
} from './db.js';
import { pickOne, buildWeek } from './suggest.js';

const COOLDOWN = Number(process.env.SUGGEST_COOLDOWN_DAYS || 3);

const HELP = [
  '🍽️ *Menu Bot*',
  '',
  '*add* dal tadka #veg #quick, pasta #veg — save items with optional tags',
  '*tag* pasta #italian #kids — add tags to an item',
  '*untag* pasta #kids — remove tags from an item',
  '*remove* pasta — delete an item',
  '*menu* — show all items (*menu* veg to filter)',
  '*tags* — list your tags',
  '*suggest* — one meal idea (*suggest* veg quick to filter)',
  '*week* — 7-day plan (*week* veg to filter)',
  '*clear* — delete everything',
  '*help* — show this message',
].join('\n');

/** Normalise a tag: lowercase, no '#', letters/digits/-/_ only. */
function cleanTag(t) {
  return t.toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]/gu, '');
}

/** "veg quick", "#veg #quick" or "veg, quick" → ['veg', 'quick'] */
function parseTags(text) {
  return [...new Set(text.split(/[\s,]+/).map(cleanTag).filter(Boolean))];
}

/** "Dal Tadka #veg #quick" → { name: 'Dal Tadka', tags: ['veg', 'quick'] } */
function parseEntry(text) {
  const hash = text.indexOf('#');
  const name = (hash === -1 ? text : text.slice(0, hash)).trim().replace(/\s+/g, ' ');
  const tags = hash === -1 ? [] : parseTags(text.slice(hash));
  return { name, tags };
}

/** Split a list of items by comma or new line, keeping each item's #tags. */
function parseEntries(text) {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    // "pasta, #veg" — a bare tag chunk after a comma belongs to the previous item
    .reduce((acc, chunk) => {
      if (chunk.startsWith('#') && acc.length) acc[acc.length - 1] += ' ' + chunk;
      else acc.push(chunk);
      return acc;
    }, [])
    .map(parseEntry)
    .filter((e) => e.name);
}

/** For tag/untag: "pasta #a #b" or "pasta: a, b" → { name, tags } */
function parseTagCommand(args) {
  if (args.includes('#')) return parseEntry(args);
  const colon = args.indexOf(':');
  if (colon === -1) return { name: args.trim(), tags: [] };
  return { name: args.slice(0, colon).trim(), tags: parseTags(args.slice(colon + 1)) };
}

function fmtItem(item) {
  return item.tags.length ? `${item.name} _(${item.tags.map((t) => '#' + t).join(' ')})_` : item.name;
}

/** Keep items that have every requested tag. */
function filterByTags(items, tags) {
  if (!tags.length) return items;
  return items.filter((i) => tags.every((t) => i.tags.includes(t)));
}

async function noMatchReply(phone, tags) {
  const available = (await tagCounts(phone)).map((t) => '#' + t.tag);
  return `No items tagged ${tags.map((t) => '#' + t).join(' + ')}.` +
    (available.length ? `\nYour tags: ${available.join(' ')}` : '\nYou have no tags yet. Try *tag* pasta #veg');
}

/** Takes the sender's phone and message text, returns the reply text. */
export async function handleMessage(phone, rawText) {
  const text = rawText.trim();
  const match = text.match(/^(\w+)\s*:?\s*([\s\S]*)$/);
  const cmd = (match?.[1] || '').toLowerCase();
  const args = match?.[2]?.trim() || '';

  switch (cmd) {
    case 'add': {
      const entries = parseEntries(args);
      if (!entries.length) return 'Tell me what to add, e.g. *add* dal tadka #veg, pasta';
      const { added, existing } = await addItems(phone, entries);
      const tagged = entries.filter((e) => e.tags.length);
      let reply = added.length ? `✅ Added: ${added.join(', ')}` : 'No new items.';
      if (existing.length) reply += `\n(Already on your menu: ${existing.join(', ')})`;
      if (tagged.length) reply += '\n🏷️ ' + tagged.map((e) => `${e.name}: ${e.tags.map((t) => '#' + t).join(' ')}`).join('\n🏷️ ');
      return reply;
    }

    case 'tag':
    case 'untag': {
      const { name, tags } = parseTagCommand(args);
      if (!name || !tags.length) return `Usage: *${cmd}* pasta #veg #quick`;
      const item = await findItem(phone, name);
      if (!item) return `❓ ${name} isn't on your menu. Add it with *add* ${name}`;
      if (cmd === 'tag') {
        await addTags(item.id, tags);
      } else if ((await removeTags(item.id, tags)) === 0) {
        return `${item.name} didn't have ${tags.map((t) => '#' + t).join(' ')}.`;
      }
      const updated = (await listItems(phone)).find((i) => i.id === item.id);
      return `🏷️ ${fmtItem(updated)}`;
    }

    case 'remove':
    case 'delete': {
      if (!args) return 'Tell me what to remove, e.g. *remove* pasta';
      const lines = [];
      for (const { name } of parseEntries(args)) {
        lines.push((await removeItem(phone, name)) ? `🗑️ ${name}` : `❓ ${name} not found`);
      }
      return lines.join('\n');
    }

    case 'menu':
    case 'list': {
      const tags = parseTags(args);
      const all = await listItems(phone);
      if (!all.length) return 'Your menu is empty. Start with *add* item1 #tag, item2';
      const items = filterByTags(all, tags);
      if (!items.length) return noMatchReply(phone, tags);
      const title = tags.length ? `📋 ${tags.map((t) => '#' + t).join(' + ')} (${items.length})` : `📋 Your menu (${items.length})`;
      return `${title}:\n` + items.map((i) => `• ${fmtItem(i)}`).join('\n');
    }

    case 'tags': {
      const counts = await tagCounts(phone);
      if (!counts.length) return 'No tags yet. Try *tag* pasta #veg #quick';
      return '🏷️ Your tags:\n' + counts.map((t) => `#${t.tag} (${t.count})`).join('\n');
    }

    case 'suggest':
    case 'today': {
      const tags = parseTags(args);
      const all = await listItems(phone);
      if (!all.length) return 'Your menu is empty. Add some items first with *add*.';
      const items = filterByTags(all, tags);
      if (!items.length) return noMatchReply(phone, tags);
      const pick = pickOne(items, COOLDOWN);
      await markSuggested([pick.id]);
      return `🍲 How about *${pick.name}*?` + (pick.tags.length ? `\n${pick.tags.map((t) => '#' + t).join(' ')}` : '');
    }

    case 'week': {
      const tags = parseTags(args);
      const all = await listItems(phone);
      if (!all.length) return 'Your menu is empty. Add some items first with *add*.';
      const items = filterByTags(all, tags);
      if (!items.length) return noMatchReply(phone, tags);
      const plan = buildWeek(items);
      await markSuggested([...new Set(plan.map((p) => p.item.id))]);
      const title = tags.length ? `📅 *Your ${tags.map((t) => '#' + t).join(' + ')} week*` : '📅 *Your week*';
      let reply = title + '\n' + plan.map((p) => `${p.day}: ${p.item.name}`).join('\n');
      if (items.length < 7) reply += `\n\n(Only ${items.length} matching item(s), so some repeat.)`;
      return reply;
    }

    case 'clear': {
      const n = await clearItems(phone);
      return `Cleared ${n} item(s).`;
    }

    default:
      return HELP;
  }
}
