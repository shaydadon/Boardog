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

// הגבלת קצב לכל IP — הגנה על מפתח ה-Anthropic מפני שריפה/ניצול לרעה.
// גבוה יחסית כי לולאת ה-Tool Use שולחת כמה קריאות לכל הודעת לקוח.
const RL_LIMIT = 30, RL_WINDOW_MS = 60000;
const rlHits = new Map(); // ip -> [timestamps] (גיבוי בזיכרון לכל isolate)
function memRateLimited(ip) {
  const now = Date.now();
  const arr = (rlHits.get(ip) || []).filter(ts => now - ts < RL_WINDOW_MS);
  arr.push(now);
  rlHits.set(ip, arr);
  if (rlHits.size > 5000) rlHits.clear();
  return arr.length > RL_LIMIT;
}
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

    // הגבלת קצב לפי IP: עדיפות ל-Durable Object (מונה עקבי בכל הקצה), גיבוי בזיכרון.
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    let limited = false;
    if (env.RATE_LIMITER_DO) {
      try {
        const stub = env.RATE_LIMITER_DO.get(env.RATE_LIMITER_DO.idFromName(ip));
        limited = (await (await stub.fetch('https://rl/hit')).json()).limited;
      } catch (e) { limited = memRateLimited(ip); }
    } else {
      limited = memRateLimited(ip);
    }
    if (limited) return json({ error: 'rate_limited', detail: 'יותר מדי בקשות. נסו שוב בעוד דקה.' }, 429, origin);

    if (!env.ANTHROPIC_API_KEY) return json({ error: 'server missing ANTHROPIC_API_KEY' }, 500, origin);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }

    // ----- תקרת AI חודשית לכל פנסיון (בקרת עלות ל-SaaS) -----
    // נאכף רק אם הוגדרו SUPABASE_SERVICE_ROLE + SUPABASE_URL; אחרת התנהגות כרגיל.
    const kennel = String(body.kennel || 'default').slice(0, 64);
    const enforce = env.SUPABASE_SERVICE_ROLE && env.SUPABASE_URL;
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const limit = parseInt(env.AI_MONTHLY_LIMIT || '2000', 10);
    // בקשת מצב שימוש (לדשבורד הבעלים) — קריאה בלבד, בלי קריאה ל-Claude
    if (body.action === 'usage') {
      const used = enforce ? await getMonthlyUsage(env, kennel, month) : null;
      return json({ enforced: !!enforce, used, limit: enforce ? limit : null }, 200, origin);
    }
    if (enforce) {
      const used = await getMonthlyUsage(env, kennel, month);
      if (used >= limit) return json({ error: 'quota_exceeded', used, limit }, 429, origin);
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-5', // עברית רהוטה ויציבה; thinking אדפטיבי + effort נמוך (מונע דליפת קריאת-כלי כטקסט)
        max_tokens: 2048,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        system: body.system,
        tools: body.tools,
        messages: body.messages
      })
    });
    const raw = await res.text();
    if (!res.ok) return json({ error: 'upstream', status: res.status, detail: raw.slice(0, 400) }, 502, origin);
    // סופרים רק בקשה שהצליחה
    if (enforce) {
      const n = await incrementMonthly(env, kennel, month);
      try { const obj = JSON.parse(raw); obj._quota = { used: (typeof n === 'number' ? n : null), limit: limit }; return json(obj, 200, origin); } catch (e) {}
    }
    return new Response(raw, { status: 200, headers: { 'content-type': 'application/json', ...cors(origin) } });
  }
};

/* ---- תקרת AI חודשית לכל פנסיון (Supabase, service_role בלבד) ---- */
async function getMonthlyUsage(env, kennel, month) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/kennel_ai_usage?kennel=eq.${encodeURIComponent(kennel)}&month=eq.${month}&select=count`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE }
    });
    if (!r.ok) return 0;
    const rows = await r.json();
    return (rows[0] && rows[0].count) || 0;
  } catch (e) { return 0; }
}
async function incrementMonthly(env, kennel, month) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_kennel_ai_usage`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE, 'content-type': 'application/json' },
      body: JSON.stringify({ p_kennel: kennel, p_month: month })
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

// Durable Object – מונה בקשות עקבי לכל IP (חלון קבוע של 60 שניות).
// גרסת SQLite (new_sqlite_classes) כדי לעבוד גם בתוכנית החינמית.
export class RateLimiter {
  constructor(state) { this.state = state; }
  async fetch() {
    const now = Date.now();
    let d = await this.state.storage.get('d');
    if (!d || now - d.start >= RL_WINDOW_MS) d = { start: now, count: 0 };
    d.count++;
    await this.state.storage.put('d', d);
    return new Response(JSON.stringify({ limited: d.count > RL_LIMIT }), { headers: { 'content-type': 'application/json' } });
  }
}
