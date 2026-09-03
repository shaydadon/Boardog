/* =============================================================
   BoarDog – Data API (Cloudflare Worker)
   שער הנתונים היחיד בין הלקוחות ל-Supabase. מחזיק את service_role
   כסוד בצד השרת, מאמת את הבעלים, ומגביל כל תפקיד למה שמותר לו.
   מטרה: לאפשר נעילת RLS מלאה (אין יותר גישת anon מהדפדפן).

   תפקידים:
   • בעלים  — נשלח JWT של Supabase (Authorization: Bearer). מאומת מול
              Supabase; מזהה הפנסיון שלו = k_<user id>. גישה מלאה לפנסיון שלו בלבד.
   • לקוח   — בלי טוקן. שולח kennel (מזהה הפנסיון). מוגבל: קריאת זמינות/
              מאפיינים, קריאת פגישות/שהיות (לחישוב חלונות), יצירת פגישה/שהייה,
              שמירת/קריאת הדוח שלו בלבד, וקריאת הודעות שנשלחו אליו.

   פריסה:
     wrangler secret put SUPABASE_SERVICE_ROLE
     [vars] SUPABASE_URL, SUPABASE_ANON
     wrangler deploy   (ראו wrangler.data.toml)
   ============================================================= */
const ALLOWED = ['https://shaydadon.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];
function cors(origin) {
  const allow = ALLOWED.indexOf(origin) !== -1 ? origin : ALLOWED[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Vary': 'Origin' };
}
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });

// ---- Supabase REST דרך service_role (עוקף RLS) ----
function sbHeaders(env, extra) {
  return Object.assign({ apikey: env.SUPABASE_SERVICE_ROLE, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE, 'content-type': 'application/json' }, extra || {});
}
async function sbGet(env, path) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { headers: sbHeaders(env) });
  if (!r.ok) return null;
  return r.json();
}
async function sbWrite(env, method, path, body, prefer) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { method, headers: sbHeaders(env, prefer ? { Prefer: prefer } : null), body: body ? JSON.stringify(body) : undefined });
  return r.ok;
}

// אימות הבעלים לפי טוקן Google (ID token) → מזהה המשתמש (sub).
// עקבי עם ה-multi-tenancy בצד הלקוח (k_<google sub>).
const DEFAULT_CLIENT_ID = '372588686007-8qmm1i1jgtfipfmbcqrsh1g2p01tp6gb.apps.googleusercontent.com';
async function verifyOwner(env, token) {
  if (!token) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
    if (!r.ok) return null;
    const p = await r.json();
    if (p.aud !== (env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID)) return null; // הונפק לאפליקציה שלנו
    if (p.exp && (Date.now() / 1000) > Number(p.exp)) return null;          // לא פג
    return p.sub || null;
  } catch (e) { return null; }
}

const CUSTOMER_TABLES = { meetings: 1, boardings: 1 }; // טבלאות שלקוח רשאי ליצור בהן

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, origin);
    if (!env.SUPABASE_SERVICE_ROLE || !env.SUPABASE_URL) return json({ error: 'server not configured' }, 500, origin);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const ownerId = await verifyOwner(env, token);
    const isOwner = !!ownerId;
    // הבעלים מוגבל לפנסיון שלו; הלקוח מספק את מזהה הפנסיון
    const kennel = isOwner ? ('k_' + ownerId) : String(body.kennel || '').slice(0, 80);
    if (!kennel) return json({ error: 'missing kennel' }, 400, origin);
    const enc = encodeURIComponent(kennel);
    const action = body.action;

    // ---------- קריאה ----------
    if (action === 'pull') {
      const [av, prof, meets, boards] = await Promise.all([
        sbGet(env, `availability?id=eq.${enc}&select=config`),
        sbGet(env, `kennel_profile?id=eq.${enc}&select=data`),
        sbGet(env, `meetings?kennel=eq.${enc}&select=data`),
        sbGet(env, `boardings?kennel=eq.${enc}&select=data`)
      ]);
      // דוחות: הבעלים מקבל הכל; לקוח מקבל רק את הדוח שלו (לפי customerId)
      let sums = [];
      const all = await sbGet(env, `summaries?kennel=eq.${enc}&select=data`) || [];
      if (isOwner) sums = all.map(r => r.data).filter(Boolean);
      else {
        const cid = String(body.customerId || '');
        sums = all.map(r => r.data).filter(d => d && d.customerId === cid);
      }
      return json({
        availability: (av && av[0] && av[0].config) || null,
        profile: (prof && prof[0] && prof[0].data) || null,
        meetings: (meets || []).map(r => r.data).filter(Boolean),
        boardings: (boards || []).map(r => r.data).filter(Boolean),
        summaries: sums
      }, 200, origin);
    }

    // תיבת דואר של לקוח (הודעות שהבעלים שלח אליו)
    if (action === 'inbox') {
      const cid = String(body.customerId || ''); if (!cid) return json({ messages: [] }, 200, origin);
      const rows = await sbGet(env, `customer_messages?customer_id=eq.${encodeURIComponent(cid)}&select=id,text,created_at&order=created_at.asc`) || [];
      return json({ messages: rows }, 200, origin);
    }

    // ---------- כתיבה ----------
    // מאפיינים/זמינות — בעלים בלבד
    if (action === 'set_availability') {
      if (!isOwner) return json({ error: 'forbidden' }, 403, origin);
      await sbWrite(env, 'POST', 'availability', { id: kennel, config: body.config || {}, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates');
      return json({ ok: true }, 200, origin);
    }
    if (action === 'set_profile') {
      if (!isOwner) return json({ error: 'forbidden' }, 403, origin);
      await sbWrite(env, 'POST', 'kennel_profile', { id: kennel, data: body.data || {}, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates');
      return json({ ok: true }, 200, origin);
    }

    // פגישות/שהיות/דוחות — לקוח רשאי ליצור; בעלים רשאי הכל
    if (action === 'upsert') {
      const table = String(body.table || '');
      const rec = body.rec;
      if (!rec || !rec.id) return json({ error: 'bad rec' }, 400, origin);
      if (!isOwner && !CUSTOMER_TABLES[table]) return json({ error: 'forbidden' }, 403, origin);
      if (table !== 'meetings' && table !== 'boardings') return json({ error: 'bad table' }, 400, origin);
      await sbWrite(env, 'POST', table, { id: rec.id, kennel: kennel, data: rec }, 'resolution=merge-duplicates');
      return json({ ok: true }, 200, origin);
    }
    if (action === 'save_summary') {
      const rec = body.rec;
      if (!rec || !rec.id) return json({ error: 'bad rec' }, 400, origin);
      // לקוח רשאי לשמור רק את הדוח שלו (id === customerId שלו)
      if (!isOwner && String(rec.customerId || '') !== String(body.customerId || '')) return json({ error: 'forbidden' }, 403, origin);
      await sbWrite(env, 'POST', 'summaries', { id: rec.id, kennel: kennel, data: rec }, 'resolution=merge-duplicates');
      return json({ ok: true }, 200, origin);
    }

    // מחיקה — בעלים בלבד
    if (action === 'delete') {
      if (!isOwner) return json({ error: 'forbidden' }, 403, origin);
      const table = String(body.table || '');
      if (table !== 'meetings' && table !== 'boardings' && table !== 'summaries') return json({ error: 'bad table' }, 400, origin);
      await sbWrite(env, 'DELETE', `${table}?id=eq.${encodeURIComponent(String(body.id || ''))}&kennel=eq.${enc}`);
      return json({ ok: true }, 200, origin);
    }
    if (action === 'clear') {
      if (!isOwner) return json({ error: 'forbidden' }, 403, origin);
      await Promise.all(['meetings', 'boardings', 'summaries'].map(t => sbWrite(env, 'DELETE', `${t}?kennel=eq.${enc}`)));
      return json({ ok: true }, 200, origin);
    }

    // הודעה מהבעלים ללקוח — בעלים בלבד
    if (action === 'send_customer_message') {
      if (!isOwner) return json({ error: 'forbidden' }, 403, origin);
      const cid = String(body.customerId || ''), id = String(body.id || ''), text = String(body.text || '');
      if (!cid || !id || !text) return json({ error: 'bad msg' }, 400, origin);
      await sbWrite(env, 'POST', 'customer_messages', { id: id, customer_id: cid, text: text });
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'unknown action' }, 400, origin);
  }
};
