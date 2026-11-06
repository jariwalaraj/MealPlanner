import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { handleMessage } from './commands.js';
import { sendText } from './whatsapp.js';

const { VERIFY_TOKEN, APP_SECRET, PORT = 3000 } = process.env;

const app = express();
// Keep the raw body so we can verify Meta's signature
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get('/', (_req, res) => res.send('Menu bot is running'));

// 1) Webhook verification (Meta calls this once when you set up the webhook)
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

function validSignature(req) {
  if (!APP_SECRET) return true; // allow during local testing; set it in production
  const header = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody || '').digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Meta may retry deliveries; remember recent message ids to avoid double replies
const seen = new Set();
function alreadySeen(id) {
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  return false;
}

// 2) Incoming messages and status updates
app.post('/webhook', async (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast so Meta doesn't retry

  const changes = (req.body.entry || []).flatMap((e) => e.changes || []);
  for (const change of changes) {
    const messages = change.value?.messages || []; // status updates have no "messages"
    for (const msg of messages) {
      if (alreadySeen(msg.id)) continue;

      try {
        const reply =
          msg.type === 'text'
            ? await handleMessage(msg.from, msg.text.body)
            : 'I only understand text messages. Send *help* to see commands.';
        await sendText(msg.from, reply);
      } catch (err) {
        console.error(err.message);
      }
    }
  }
});

app.listen(PORT, () => console.log(`Menu bot listening on port ${PORT}`));
