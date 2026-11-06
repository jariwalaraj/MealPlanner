const API_VERSION = process.env.GRAPH_API_VERSION || 'v23.0';

export async function sendText(to, body) {
  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: body.slice(0, 4096) }, // WhatsApp text limit
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${err}`);
  }
  return res.json();
}
