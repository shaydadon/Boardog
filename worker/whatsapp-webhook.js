/* =============================================================
   BoarDog – WhatsApp Webhook (Cloudflare Worker) · שלד
   -------------------------------------------------------------
   מקבל הודעות מ-WhatsApp Cloud API (Meta), מריץ את מנוע הקליטה
   בצד השרת, ומשיב ללקוח בוואטסאפ. הזמינות/הפגישות/השהיות נקראות
   ונכתבות לאותן טבלאות Supabase שהאפליקציה משתמשת בהן — כך
   שהזמנה שנקבעת בוואטסאפ מופיעה מיד בדשבורד הבעלים (owner.html).

   זהו *שלד*: זרימת התשאול המונחית (INTAKE) פורטה לצד השרת; שדרוג
   ל-Claude Tool Use אפשרי בהמשך (ראו TODO בתחתית).

   ── משתני סביבה (wrangler secret put / vars) ──────────────────
     WHATSAPP_TOKEN       אסימון גישה קבוע/זמני מ-Meta (Bearer)
     PHONE_NUMBER_ID      מזהה מספר השולח מ-WhatsApp Cloud API
     VERIFY_TOKEN         מחרוזת סוד שתגדירו גם ב-Meta לאימות ה-webhook
     SUPABASE_URL         https://<ref>.supabase.co
     SUPABASE_KEY         service_role key (מומלץ) או anon אם RLS פתוח
     ANTHROPIC_API_KEY    (רשות) אם מוגדר — שיחה טבעית עם Claude; אחרת מנוע מונחה
     REMIND_AFTER_HOURS   (רשות) שעות מהפגישה עד תזכורת תאריכים (ברירת מחדל 24)
     GRAPH_VERSION        (רשות) ברירת מחדל v21.0
     MODEL                (רשות) ברירת מחדל claude-opus-5

   ── תזכורת אוטומטית (Cron) ────────────────────────────────────
     דורש Cron Trigger (ראו worker/wrangler.whatsapp.toml). ה-Worker
     סורק פגישות היכרות שעברו ולא שוריינו להן תאריכים, ושולח ללקוח
     תזכורת פעם אחת. פריסה עם קובץ הקונפיג:
       wrangler deploy -c worker/wrangler.whatsapp.toml

   ── פריסה ─────────────────────────────────────────────────────
     wrangler deploy
     ואז ב-Meta → WhatsApp → Configuration → Webhook:
       Callback URL = https://<worker>/webhook
       Verify token = VERIFY_TOKEN
       Subscribe to field: messages

   ── טבלת שיחות ב-Supabase (נדרש) ──────────────────────────────
     create table conversations (
       phone text primary key, state jsonb, updated_at timestamptz default now()
     );
     alter table conversations enable row level security;
     create policy "srv" on conversations for all using (true) with check (true);
   ============================================================= */

const KENNEL = { name: 'הפנסיון של ג׳רי', ownerName: 'שי' };
const KENNEL_ID = 'jerry';

/* ---------- מאגר ידע (FAQ) לשאלות פתוחות תוך כדי הקליטה ---------- */
const INFO = {
  price: 'מחיר: 120 ₪ ליום. מעל 7 ימים — 100 ₪ ליום.',
  hours: 'שעות קבלה ואיסוף: א׳–ה׳ 08:00–19:00, ו׳ 08:00–13:00. בשבת סגור.',
  bring: 'כדאי להביא: האוכל הרגיל של הכלב, מיטה/שמיכה מוכרת, צעצוע אהוב, ותרופות אם יש.',
  medical: 'דרישות רפואיות: חיסונים בתוקף (כלבת, משושה, שיעול כלבים) וטיפול עדכני נגד פרעושים וקרציות.',
  sizes: 'אנחנו מקבלים כלבים בכל הגדלים, עם חצרות משחק נפרדות לפי גודל ואופי.',
  updates: 'מקבלים עדכוני תמונות יומיים בוואטסאפ 📸.',
  food: 'אנחנו מאכילים לפי ההנחיות שלכם ובלו״ז שאתם קובעים.',
  cancel: 'ביטול עד 48 שעות לפני מועד השהייה — ללא חיוב.'
};
const FAQ = [
  { k: ['מחיר', 'עולה', 'עלות', 'כמה זה', 'תשלום', 'מחירון'], a: INFO.price },
  { k: ['שעות', 'מתי פתוח', 'קבלה', 'איסוף', 'שבת'], a: INFO.hours },
  { k: ['להביא', 'מביא', 'ציוד'], a: INFO.bring },
  { k: ['חיסון', 'רפואי', 'בריאות', 'וטרינר', 'כלבת'], a: INFO.medical },
  { k: ['גדול', 'קטן', 'גודל', 'גזע'], a: INFO.sizes },
  { k: ['תמונות', 'מצלמה', 'עדכון', 'לראות'], a: INFO.updates },
  { k: ['אוכל', 'האכלה', 'מזון', 'דיאטה'], a: INFO.food },
  { k: ['ביטול', 'לבטל', 'החזר'], a: INFO.cancel }
];
const QWORDS = /^(כמה|מה|מהו|מהי|האם|איך|כיצד|מתי|איפה|היכן|יש|אפשר|למה|מדוע|מי|צריך)\b/;
const isQuestion = (t) => /[?？]/.test(t) || QWORDS.test((t || '').trim());
const faqAnswer = (t) => { const s = (t || '').toLowerCase(); const hit = FAQ.find(f => f.k.some(w => s.indexOf(w) !== -1)); return hit ? hit.a : null; };

/* ---------- סכימת התשאול ---------- */
const INTAKE = [
  { key: 'ownerName', q: 'נעים מאוד! 🐾 קודם כול — איך קוראים לך?' },
  { key: 'dogName', q: 'ואיך קוראים לכלב/ה שלך?' },
  { key: 'breed', q: 'איזה גזע {dogName}?' },
  { key: 'age', q: 'בן/בת כמה {dogName}? (אפשר בשנים)' },
  { key: 'size', q: 'מה הגודל בערך? (קטן / בינוני / גדול)' },
  { key: 'neutered', q: 'האם {dogName} מעוקר/ת או מסורס/ת? (כן / לא)' },
  { key: 'vaccinated', q: 'האם החיסונים בתוקף? (כלבת, משושה, שיעול כלבים)' },
  { key: 'fleaTick', q: 'יש טיפול עדכני נגד פרעושים וקרציות? (כן / לא)' },
  { key: 'health', q: 'יש בעיות בריאות או תרופות שחשוב שנדע עליהן? (אם אין, כתבו "אין")' },
  { key: 'withDogs', q: 'איך {dogName} מסתדר/ת עם כלבים אחרים? (מצוין / בסדר / מעדיף להתרחק)' },
  { key: 'aggression', q: 'האם היו בעבר אירועי תוקפנות או נשיכה? (לא / כן)' },
  { key: 'food', q: 'מה האוכל של {dogName} ובאיזה לו"ז? (מותג + כמה פעמים ביום)' }
];
const fill = (s, a) => s.replace(/\{(\w+)\}/g, (_, k) => a[k] || 'הכלב');

/* ---------- כלי תאריכים ---------- */
const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* חלונות פנויים לפגישת היכרות (לפי זמינות פחות מה שנקבע) — פורט מ-store.js */
function deriveSlots(availability, meetings, days) {
  days = days || 14;
  const avail = availability || {};
  const taken = new Set((meetings || []).map(m => (m.date || '') + ' ' + (m.time || '')));
  const now = new Date();
  const out = [];
  for (let d = 1; d <= days && out.length < 6; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const hours = avail[date.getDay()] || [];
    for (const h of hours) {
      const dk = dkey(date), tm = pad(h) + ':00';
      if (taken.has(dk + ' ' + tm)) continue;
      out.push({ id: dk + '_' + h, date: dk, time: tm, label: `יום ${DOW[date.getDay()]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)} בשעה ${tm}` });
    }
  }
  return out;
}
const parseDate = s => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

/* =============================================================
   Supabase (PostgREST) — קריאה/כתיבה מצד השרת
   ============================================================= */
function sbHeaders(env) {
  return { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY, 'content-type': 'application/json' };
}
async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
  if (!r.ok) return [];
  try { return await r.json(); } catch (e) { return []; }
}
async function sbUpsert(env, table, row, onConflict) {
  const q = onConflict ? `?on_conflict=${onConflict}` : '';
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: { ...sbHeaders(env), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row)
  });
}
const uid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

async function loadState(env, phone) {
  const rows = await sbGet(env, `conversations?phone=eq.${encodeURIComponent(phone)}&select=state`);
  return (rows[0] && rows[0].state) || { step: -1, answers: {}, phase: 'intake' };
}
async function saveState(env, phone, state) {
  await sbUpsert(env, 'conversations', { phone, state, updated_at: new Date().toISOString() }, 'phone');
}
async function loadAvailability(env) {
  const rows = await sbGet(env, `availability?id=eq.${KENNEL_ID}&select=config`);
  return (rows[0] && rows[0].config) || {};
}
async function loadMeetings(env) {
  const rows = await sbGet(env, `meetings?kennel=eq.${KENNEL_ID}&select=data`);
  return rows.map(r => r.data).filter(Boolean);
}
async function loadMeetingRows(env) {
  return await sbGet(env, `meetings?kennel=eq.${KENNEL_ID}&select=id,data`);
}
async function loadBoardings(env) {
  const rows = await sbGet(env, `boardings?kennel=eq.${KENNEL_ID}&select=data`);
  return rows.map(r => r.data).filter(Boolean);
}
async function addMeeting(env, rec) {
  const id = uid();
  await sbUpsert(env, 'meetings', { id, kennel: KENNEL_ID, data: { id, ...rec } }, 'id');
  return id;
}
async function addBoarding(env, rec) {
  const id = uid();
  await sbUpsert(env, 'boardings', { id, kennel: KENNEL_ID, data: { id, ...rec } }, 'id');
}
async function updateMeetingData(env, id, data) {
  await sbUpsert(env, 'meetings', { id, kennel: KENNEL_ID, data }, 'id');
}
// לקוח חוזר לפי מספר טלפון (יש לו שהייה קודמת)
async function returningInfo(env, phone) {
  const b = await loadBoardings(env);
  const mine = b.filter(x => x.phone && x.phone === phone);
  if (!mine.length) return { returning: false };
  const last = mine[mine.length - 1];
  return { returning: true, ownerName: last.ownerName || '', dogName: last.dogName || '' };
}

/* =============================================================
   מנוע הקליטה (state machine) — מחזיר תשובות טקסט לשליחה
   ============================================================= */
async function handleMessage(env, state, textRaw) {
  const text = (textRaw || '').trim();
  const a = state.answers;
  const replies = [];

  // איפוס שיחה
  if (/^(התחל|restart|reset|שיחה חדשה)/i.test(text)) {
    state = { step: -1, answers: {}, phase: 'intake' };
  }

  // שאלה פתוחה תוך כדי (בכל שלב) — עונים ואז ממשיכים מאותו מקום
  if (state.phase === 'intake' && state.step >= 0 && isQuestion(text)) {
    replies.push(faqAnswer(text) || `שאלה טובה! 🙂 אעביר ל${KENNEL.ownerName} והוא יחזור אליך. בינתיים נמשיך —`);
    const cur = INTAKE[state.step];
    if (cur) replies.push(fill(cur.q, a));
    return { state, replies };
  }

  // ── שלב התשאול ──
  if (state.phase === 'intake') {
    if (state.step === -1) {
      // לקוח חוזר → דילוג על התשאול, ישר לשריון תאריכים
      const info = await returningInfo(env, state.phone);
      if (info.returning) {
        a.ownerName = info.ownerName; a.dogName = info.dogName;
        state.phase = 'boarding'; state.returning = true;
        replies.push(`שלום ${info.ownerName || ''}! 👋 שמחים לראותך שוב ב${KENNEL.name} 🎾`);
        replies.push(`לאילו תאריכים לשריין את השהייה של ${info.dogName || 'הכלב'} הפעם? (למשל: 2026-09-10 עד 2026-09-14)`);
        return { state, replies };
      }
      replies.push(`שלום! 👋 הגעתם ל${KENNEL.name}. אני העוזר הדיגיטלי ואשמח לקלוט את הפרטים לקראת שהייה.`);
    } else {
      const cur = INTAKE[state.step];
      if (cur) a[cur.key] = text; // שומרים את התשובה לשאלה הקודמת
    }
    state.step++;
    if (state.step < INTAKE.length) {
      replies.push(fill(INTAKE[state.step].q, a));
      return { state, replies };
    }
    // סיום תשאול → הצעת מועדים
    return offerSlots(env, state, replies);
  }

  // ── בחירת מועד פגישת היכרות ──
  if (state.phase === 'slots') {
    const n = parseInt(text.replace(/[^\d]/g, ''), 10);
    const slot = state.slots && state.slots[n - 1];
    if (!slot) {
      replies.push('לא הבנתי איזה מועד 🤔 שלחו את *המספר* של המועד מהרשימה.');
      state.slots.forEach((s, i) => replies.push(`${i + 1}. ${s.label}`));
      return { state, replies };
    }
    // ודא שעדיין פנוי
    const fresh = deriveSlots(await loadAvailability(env), await loadMeetings(env));
    if (!fresh.some(s => s.id === slot.id)) {
      replies.push('אוי, נראה שהמועד הזה נתפס בינתיים 😅 בוא/י נבחר אחר:');
      return offerSlots(env, state, replies);
    }
    await addMeeting(env, { date: slot.date, time: slot.time, dogName: a.dogName, ownerName: a.ownerName, breed: a.breed, phone: state.phone });
    a.meeting = slot.label;
    // לקוח חדש: מסתיים בפגישת ההיכרות. תאריכי השהייה ייקבעו יחד בפגישה.
    replies.push(`מעולה! ✅ קבעתי פגישת היכרות ל${slot.label}.`);
    replies.push(`ניפגש אז ונכיר את ${a.dogName || 'הכלב'} 🐶. את תאריכי השהייה נסגור יחד עם ${KENNEL.ownerName} בפגישה. נתראה! 🎾`);
    state.phase = 'done';
    return { state, replies };
  }

  // ── תאריכי שהייה ──
  if (state.phase === 'boarding') {
    const dates = (text.match(/\d{4}-\d{2}-\d{2}/g) || []).map(parseDate).filter(Boolean);
    if (dates.length < 2) {
      replies.push('אפשר לשלוח את טווח התאריכים בפורמט: 2026-09-10 עד 2026-09-14 🗓️');
      return { state, replies };
    }
    const [start, end] = dates[0] <= dates[1] ? [dates[0], dates[1]] : [dates[1], dates[0]];
    await addBoarding(env, { dogName: a.dogName, ownerName: a.ownerName, start, end, phone: state.phone });
    replies.push(`סגור! 🐶 רשמתי שהייה מ-${start} עד ${end}.`);
    replies.push(`שלחתי את כל הפרטים ל${KENNEL.ownerName} מהפנסיון — הוא יאשר סופית ויחזור אליך אם צריך. נתראה! 🎾`);
    state.phase = 'done';
    return { state, replies };
  }

  // ── לאחר סיום ──
  if (isQuestion(text)) { replies.push(faqAnswer(text) || `אעביר ל${KENNEL.ownerName} והוא יחזור אליך 🙂`); return { state, replies }; }
  replies.push('הקליטה כבר הושלמה ✅ לפתיחת פנייה חדשה שלחו "התחל".');
  return { state, replies };
}

async function offerSlots(env, state, replies) {
  const slots = deriveSlots(await loadAvailability(env), await loadMeetings(env)).slice(0, 5);
  if (!slots.length) {
    replies.push(`כרגע אין מועדים פנויים לפגישת היכרות 😕 נעביר את זה ל${KENNEL.ownerName} שיחזור אליך.`);
    state.phase = 'done';
    return { state, replies };
  }
  replies.push(`תודה ${state.answers.ownerName || ''}! 🙌 לפני קליטה נקבע פגישת היכרות קצרה.\nהנה המועדים הפנויים — שלחו את המספר שמתאים:`);
  slots.forEach((s, i) => replies.push(`${i + 1}. ${s.label}`));
  state.slots = slots;
  state.phase = 'slots';
  return { state, replies };
}

/* =============================================================
   מנוע AI (Claude + Tool Use) — שיחה טבעית בצד השרת
   פעיל כאשר מוגדר ANTHROPIC_API_KEY; אחרת נופלים למנוע המונחה.
   ============================================================= */
const knowledge = () => Object.values(INFO).join('\n');
const AI_SYSTEM =
  'את/ה עוזר/ת וירטואלי/ת של פנסיון כלבים בשם "' + KENNEL.name + '" (מנהל: ' + KENNEL.ownerName + '). ' +
  'קלוט/י לקוח חדש בצ\'אט וואטסאפ בעברית, בחום ובקצרה (שאלה אחת-שתיים בכל פעם, אפשר אימוג\'ים). ' +
  'הלקוח יכול לשאול שאלות פתוחות בכל שלב — ענה/י לפי "מידע על הפנסיון" למטה ואל תמציא/י עובדות. ' +
  'אסוף/אספי: שם בעלים, שם כלב, גזע, גיל, גודל, עיקור/סירוס, חיסונים, פרעושים/קרציות, בריאות/תרופות, ' +
  'התאמה לכלבים אחרים, עבר תוקפנות, אוכל ולו"ז. ' +
  'לאחר מכן קרא/י ל-get_available_slots והצג/י 3–5 מועדים לפגישת היכרות; כשהלקוח בוחר — book_meeting (עם slot_id, dog_name, owner_name). ' +
  'אחר כך בקש/י את תאריכי השהייה בפנסיון וקרא/י ל-book_boarding (start_date, end_date, dog_name, owner_name) בפורמט YYYY-MM-DD. ' +
  'לבסוף save_summary עם כל הנתונים, והודה/י ללקוח.\n\nמידע על הפנסיון:\n' + knowledge();

const AI_TOOLS = [
  { name: 'get_available_slots', description: 'מחזיר מועדי פגישות היכרות פנויים.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'book_meeting', description: 'משריין פגישת היכרות.', input_schema: { type: 'object', properties: { slot_id: { type: 'string' }, dog_name: { type: 'string' }, owner_name: { type: 'string' } }, required: ['slot_id'], additionalProperties: true } },
  { name: 'book_boarding', description: 'משריין שהייה בפנסיון לטווח תאריכים.', input_schema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' }, dog_name: { type: 'string' }, owner_name: { type: 'string' } }, required: ['start_date', 'end_date'], additionalProperties: true } },
  { name: 'save_summary', description: 'שומר את סיכום הקליטה עבור בעל הפנסיון.', input_schema: { type: 'object', properties: {}, additionalProperties: true } }
];

function buildSystem(state) {
  if (state.returning) {
    return AI_SYSTEM + `\n\n[הקשר] הפונה הוא לקוח קיים (שם: ${state.custName || ''}, כלב: ${state.custDog || ''}). ` +
      'דלג/י על התשאול לגמרי, ברך/י אותו בשמו ובקש/י ישירות את תאריכי השהייה, ואז קרא/י ל-book_boarding ולבסוף save_summary.';
  }
  return AI_SYSTEM + `\n\n[הקשר] פונה חדש. בצע/י תשאול קצר, קבע/י פגישת היכרות עם book_meeting, ` +
    `ואז *אל תשריין/י תאריכי שהייה ואל תקרא/י ל-book_boarding* — הסבר/י שהתאריכים ייקבעו בפגישה עם ${KENNEL.ownerName}, קרא/י ל-save_summary וסיים/י.`;
}
async function callClaude(env, messages, system) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.MODEL || 'claude-opus-5', max_tokens: 1024, system: system || AI_SYSTEM, tools: AI_TOOLS, messages })
  });
  if (!r.ok) throw new Error('claude ' + r.status);
  return r.json();
}

async function runToolAI(env, name, input, state) {
  if (name === 'get_available_slots') {
    const slots = deriveSlots(await loadAvailability(env), await loadMeetings(env)).slice(0, 6);
    state.slots = slots;
    return { slots: slots.map(s => ({ id: s.id, label: s.label })) };
  }
  if (name === 'book_meeting') {
    const fresh = deriveSlots(await loadAvailability(env), await loadMeetings(env));
    const slot = fresh.find(s => s.id === input.slot_id);
    if (!slot) return { ok: false, reason: 'המועד לא פנוי או לא תקין — קרא שוב ל-get_available_slots והצע מועד אחר' };
    await addMeeting(env, { date: slot.date, time: slot.time, dogName: input.dog_name || '', ownerName: input.owner_name || '', phone: state.phone });
    return { ok: true, booked: slot.label };
  }
  if (name === 'book_boarding') {
    const s = parseDate(input.start_date), e = parseDate(input.end_date);
    if (!s || !e) return { ok: false, reason: 'תאריכים לא תקינים — נדרש פורמט YYYY-MM-DD' };
    const [start, end] = s <= e ? [s, e] : [e, s];
    await addBoarding(env, { dogName: input.dog_name || '', ownerName: input.owner_name || '', start, end, phone: state.phone });
    return { ok: true, from: start, to: end };
  }
  if (name === 'save_summary') { state.summary = input || {}; return { ok: true }; }
  return { ok: false };
}

async function handleMessageAI(env, state, text) {
  if (!Array.isArray(state.messages)) state.messages = [];
  if (/^(התחל|restart|reset|שיחה חדשה)/i.test((text || '').trim())) { state.messages = []; state.summary = null; state.returning = undefined; }
  // זיהוי לקוח חוזר פעם אחת בתחילת השיחה (לפי טלפון)
  if (state.returning === undefined) {
    const info = await returningInfo(env, state.phone);
    state.returning = info.returning; state.custName = info.ownerName || ''; state.custDog = info.dogName || '';
  }
  state.messages.push({ role: 'user', content: text || '' });

  const replies = [];
  try {
    for (let i = 0; i < 6; i++) {
      const res = await callClaude(env, state.messages, buildSystem(state));
      state.messages.push({ role: 'assistant', content: res.content });
      const texts = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (texts) replies.push(texts);
      const toolUses = res.content.filter(b => b.type === 'tool_use');
      if (res.stop_reason === 'tool_use' && toolUses.length) {
        const results = [];
        for (const tu of toolUses) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(await runToolAI(env, tu.name, tu.input || {}, state)) });
        }
        state.messages.push({ role: 'user', content: results });
        continue;
      }
      break;
    }
  } catch (e) {
    replies.push('אירעה תקלה זמנית 🙏 אפשר לנסות שוב, או שאעביר את הפנייה ל' + KENNEL.ownerName + '.');
  }
  // הגבלת אורך ההיסטוריה כדי לא לתפוח (שומרים את הסבב האחרון)
  if (state.messages.length > 40) state.messages = state.messages.slice(-40);
  return { state, replies };
}

/* =============================================================
   WhatsApp Cloud API — שליחת הודעת טקסט
   ============================================================= */
async function sendText(env, to, body) {
  const ver = env.GRAPH_VERSION || 'v21.0';
  await fetch(`https://graph.facebook.com/${ver}/${env.PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.WHATSAPP_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } })
  });
}

/* =============================================================
   תזכורת אוטומטית: אם עברו X שעות מפגישת ההיכרות ולא שוריינו תאריכים
   → שולחים ללקוח הודעת תזכורת (פעם אחת). רץ מ-Cron Trigger.
   ============================================================= */
async function runReminders(env) {
  const afterH = parseInt(env.REMIND_AFTER_HOURS || '24', 10);
  const rows = await loadMeetingRows(env);       // [{id, data}]
  const boardings = await loadBoardings(env);
  const now = Date.now();
  for (const row of rows) {
    const m = row.data || {};
    if (!m.date || !m.time || !m.phone || m.remindedAt) continue;
    // האם כבר שוריינו תאריכים (מקושר לפגישה או לאותו טלפון)
    const fulfilled = boardings.some(b => b.meetingId === row.id || (b.phone && b.phone === m.phone));
    if (fulfilled) continue;
    const hhmm = (m.time || '00:00').slice(0, 5);
    const mt = new Date(`${m.date}T${hhmm}:00`).getTime();
    if (isNaN(mt)) continue;
    if (now < mt + afterH * 3600 * 1000) continue;        // עדיין לא הגיע הזמן
    if (now - mt > 14 * 24 * 3600 * 1000) continue;        // ישן מדי — לא מזכירים
    await sendText(env, m.phone,
      `היי ${m.ownerName || ''} 🐾 נעים היה להכיר! שמנו לב שעדיין לא נקבעו תאריכי שהייה ל${m.dogName || 'הכלב'} ב${KENNEL.name}. ` +
      `רוצים שנשריין? שלחו לי טווח תאריכים (למשל 2026-09-10 עד 2026-09-14) ואשמח לסדר 🎾`);
    await updateMeetingData(env, row.id, { ...m, remindedAt: new Date().toISOString() });
  }
}

/* =============================================================
   נקודת הכניסה
   ============================================================= */
export default {
  // Cron Trigger — סריקת תזכורות
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);

    // אימות ה-webhook מול Meta
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token && token === env.VERIFY_TOKEN) {
        return new Response(challenge || '', { status: 200 });
      }
      return new Response('forbidden', { status: 403 });
    }

    if (request.method !== 'POST') return new Response('method', { status: 405 });

    let body;
    try { body = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }

    // חילוץ הודעות נכנסות (מתעלמים מעדכוני סטטוס וכו')
    try {
      const entries = body.entry || [];
      for (const entry of entries) {
        for (const change of (entry.changes || [])) {
          const value = change.value || {};
          const messages = value.messages || [];
          for (const msg of messages) {
            const from = msg.from; // מספר הטלפון של הלקוח (wa_id)
            const text = msg.type === 'text' ? (msg.text && msg.text.body)
              : msg.type === 'interactive' ? (msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '')
              : '';
            if (!from) continue;

            let state = await loadState(env, from);
            state.phone = from;
            // מנוע Claude אם מוגדר מפתח; אחרת המנוע המונחה
            const engine = env.ANTHROPIC_API_KEY ? handleMessageAI : handleMessage;
            const { state: next, replies } = await engine(env, state, text);
            await saveState(env, from, next);
            for (const r of replies) await sendText(env, from, r);
          }
        }
      }
    } catch (e) {
      // בולעים שגיאות כדי להחזיר 200 ל-Meta (אחרת היא תשלח שוב ושוב)
    }

    // Meta מצפה ל-200 מהיר
    return new Response('ok', { status: 200 });
  }
};

/* =============================================================
   TODO – שדרוגים לאחר השלד
   • [בוצע] Claude Tool Use: שיחה טבעית עם המודל (handleMessageAI) —
     פעיל אוטומטית כשמוגדר ANTHROPIC_API_KEY.
   • [בוצע] לקוח חוזר מדלג על התשאול; לקוח חדש מסיים בפגישת היכרות
     ותאריכי השהייה נקבעים אחריה; תזכורת אוטומטית אם לא שוריינו (Cron).
   • כפתורים/רשימות אינטראקטיביים של WhatsApp במקום מספרים בטקסט.
   • דדופ לפי msg.id (למניעת עיבוד כפול בעת ניסיונות חוזרים של Meta).
   • התראה לבעל הפנסיון (הודעת WhatsApp/מייל) על ליד/פגישה חדשה.
   • ריבוי פנסיונים: מיפוי PHONE_NUMBER_ID → KENNEL_ID.
   ============================================================= */
