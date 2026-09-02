/* =============================================================
   BoarDog – Cloudflare Worker proxy ל-Claude
   מחזיק את מפתח ה-Anthropic כסוד בצד השרת. הלקוח שולח
   { system, tools, messages } וה-Worker מעביר ל-Claude ומחזיר
   את תשובת המודל כמו שהיא (כולל בלוקי tool_use). לולאת ה-Tool Use
   עצמה רצה בצד הלקוח (הוא מריץ get_available_slots/book_meeting).

   פריסה:
     1) npm i -g wrangler
     2) wrangler secret put ANTHROPIC_API_KEY
     3) wrangler deploy
   ============================================================= */
const ALLOWED = [
  'https://shaydadon.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];
function cors(origin) {
  const allow = ALLOWED.indexOf(origin) !== -1 ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin'
  };
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, origin);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'server missing ANTHROPIC_API_KEY' }, 500, origin);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-opus-5',
        max_tokens: 2048,
        output_config: { effort: 'low' }, // צ'אט קליטה — חשיבה רדודה, מהיר וזול, פחות עומס/מגבלת-קצב
        system: body.system,
        tools: body.tools,
        messages: body.messages
      })
    });
    const raw = await res.text();
    if (!res.ok) return json({ error: 'upstream', status: res.status, detail: raw.slice(0, 400) }, 502, origin);
    return new Response(raw, { status: 200, headers: { 'content-type': 'application/json', ...cors(origin) } });
  }
};
