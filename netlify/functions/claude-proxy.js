exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let prompt;
  try { ({ prompt } = JSON.parse(event.body)); } catch(e) { return { statusCode: 400, body: '{}' }; }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    const text = d.content?.find(b => b.type === 'text')?.text || '';
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ text }) };
  } catch(e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
};
