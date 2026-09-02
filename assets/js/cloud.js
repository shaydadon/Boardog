/* =============================================================
   BoarDog – שרת משותף (Supabase)
   מסנכרן בזמן אמת את הזמינות, פגישות ההיכרות והשהיות בין צד הלקוח
   לצד בעל הפנסיון — על פני מכשירים שונים. הבעלים קובע זמינות → הלקוח
   רואה ומזמין → הבעלים רואה את ההזמנה מיד.

   מבנה: מאגר משותף אחד לפנסיון (KENNEL_ID). ללא התחברות — פרוטוטיפ
   פתוח (anon read/write). מה שנשמר מקומית ממשיך לעבוד גם בלי רשת.
   ============================================================= */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://egznewpwbcnhkzhmpckk.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnem5ld3B3YmNuaGt6aG1wY2trIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODg2MTQsImV4cCI6MjEwMzc2NDYxNH0.NXvgGh9BhLwlzyhKo1SZWmaVsyqutd1-PUpW1hR8oKI';
  let KENNEL_ID = null; // מזהה הפנסיון — נקבע לפי חשבון הבעלים המחובר (או ?k= בצד הלקוח)

  const K = { avail: 'boardog.availability', meet: 'boardog.meetings', board: 'boardog.boardings', prof: 'boardog.profile', sum: 'boardog.summaries' };
  const S = window.BoarDogStore;
  if (!S) return;

  const setLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const getLocal = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } };
  const emit = () => document.dispatchEvent(new CustomEvent('boardog:sync'));

  let sb = null;

  /* ---------- עטיפת פעולות הכתיבה של המאגר → דחיפה לשרת ---------- */
  const _setAvail = S.setAvailability.bind(S);
  S.setAvailability = function (cfg) { _setAvail(cfg); pushAvail(cfg); };

  const _setProfile = S.setProfile.bind(S);
  S.setProfile = function (p) { _setProfile(p); pushProfile(p); };

  const _addMeeting = S.addMeeting.bind(S);
  S.addMeeting = function (m) { const rec = _addMeeting(m); pushInsert('meetings', rec); return rec; };

  const _addBoarding = S.addBoarding.bind(S);
  S.addBoarding = function (b) { const rec = _addBoarding(b); pushInsert('boardings', rec); return rec; };

  const _updateMeeting = S.updateMeeting.bind(S);
  S.updateMeeting = function (rec) { const out = _updateMeeting(rec); const full = S.meetings().find(m => m.id === (rec && rec.id)); if (full) pushInsert('meetings', full); return out; };

  const _updateBoarding = S.updateBoarding.bind(S);
  S.updateBoarding = function (rec) { const out = _updateBoarding(rec); const full = S.boardings().find(b => b.id === (rec && rec.id)); if (full) pushInsert('boardings', full); return out; };

  const _saveSummary = S.saveSummary.bind(S);
  S.saveSummary = function (data) { const rec = _saveSummary(data); if (rec) pushInsert('summaries', rec); return rec; };

  const _removeMeeting = S.removeMeeting.bind(S);
  S.removeMeeting = function (id) { _removeMeeting(id); pushDelete('meetings', id); };

  const _removeBoarding = S.removeBoarding.bind(S);
  S.removeBoarding = function (id) { _removeBoarding(id); pushDelete('boardings', id); };

  /* ---------- דחיפות ---------- */
  async function pushAvail(cfg) {
    if (!sb) return;
    try { await sb.from('availability').upsert({ id: KENNEL_ID, config: cfg, updated_at: new Date().toISOString() }, { onConflict: 'id' }); } catch (e) {}
  }
  async function pushProfile(p) {
    if (!sb) return;
    try { await sb.from('kennel_profile').upsert({ id: KENNEL_ID, data: p || {}, updated_at: new Date().toISOString() }, { onConflict: 'id' }); } catch (e) {}
  }
  async function pushInsert(table, rec) {
    if (!sb || !rec || !rec.id) return;
    try { await sb.from(table).upsert({ id: rec.id, kennel: KENNEL_ID, data: rec }, { onConflict: 'id' }); } catch (e) {}
  }
  async function pushDelete(table, id) {
    if (!sb) return;
    try { await sb.from(table).delete().eq('id', id); } catch (e) {}
  }

  /* ---------- משיכה מהשרת → מקומי → רענון מסך ---------- */
  async function pull() {
    if (!sb) return;
    try {
      const [a, m, b, p, s] = await Promise.all([
        sb.from('availability').select('config').eq('id', KENNEL_ID).maybeSingle(),
        sb.from('meetings').select('data').eq('kennel', KENNEL_ID),
        sb.from('boardings').select('data').eq('kennel', KENNEL_ID),
        sb.from('kennel_profile').select('data').eq('id', KENNEL_ID).maybeSingle(),
        sb.from('summaries').select('data').eq('kennel', KENNEL_ID)
      ]);
      if (a.data && a.data.config) setLocal(K.avail, a.data.config);
      if (m.data) setLocal(K.meet, m.data.map(r => r.data).filter(Boolean));
      if (b.data) setLocal(K.board, b.data.map(r => r.data).filter(Boolean));
      if (p.data && p.data.data) setLocal(K.prof, p.data.data);
      if (s.data) setLocal(K.sum, s.data.map(r => r.data).filter(Boolean));
      emit();
    } catch (e) {}
  }

  /* ---------- זריעה ראשונית אם השרת ריק ---------- */
  async function seedIfEmpty() {
    if (!sb) return;
    try {
      const a = await sb.from('availability').select('id').eq('id', KENNEL_ID).maybeSingle();
      if (!a.data) await pushAvail(getLocal(K.avail, null) || S.availability());
      const m = await sb.from('meetings').select('id').eq('kennel', KENNEL_ID).limit(1);
      if (m.data && m.data.length === 0) { for (const rec of getLocal(K.meet, [])) await pushInsert('meetings', rec); }
      const b = await sb.from('boardings').select('id').eq('kennel', KENNEL_ID).limit(1);
      if (b.data && b.data.length === 0) { for (const rec of getLocal(K.board, [])) await pushInsert('boardings', rec); }
      const s = await sb.from('summaries').select('id').eq('kennel', KENNEL_ID).limit(1);
      if (s.data && s.data.length === 0) { for (const rec of getLocal(K.sum, [])) await pushInsert('summaries', rec); }
    } catch (e) {}
  }

  /* ---------- זמן אמת ---------- */
  let MYID = (S.customerId ? S.customerId() : null);
  async function sendCustomerMessage(customerId, id, text) {
    if (!sb || !customerId) return;
    try { await sb.from('customer_messages').insert({ id: id, customer_id: customerId, text: text }); } catch (e) {}
  }

  function subscribe() {
    if (!sb) return;
    try {
      sb.channel('kennel-' + KENNEL_ID)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, pull)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'boardings' }, pull)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, pull)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kennel_profile' }, pull)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'summaries' }, pull)
        .subscribe();
    } catch (e) {}
    // הודעות מהבעלים ללקוח הזה (לפי מזהה הלקוח) — מגיעות בזמן אמת גם בין מכשירים
    if (MYID) {
      try {
        sb.channel('cust-' + MYID)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_messages', filter: 'customer_id=eq.' + MYID }, (payload) => {
            const row = payload.new || {};
            if (row.text) { S.pushCustomerMsg(row.text, row.id); document.dispatchEvent(new CustomEvent('boardog:inbox')); }
          })
          .subscribe();
      } catch (e) {}
    }
  }

  /* ---------- רשתות ביטחון לרענון (משלימות את ה-realtime) ---------- */
  function startAutoRefresh() {
    // חזרה לטאב / פוקוס → משיכה מיידית (מושלם למעבר בין טאב הבעלים לטאב הלקוח)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    window.addEventListener('focus', pull);
    // מרפא-עצמי: משיכה תקופתית אם ה-realtime החמיץ אירוע
    setInterval(() => { if (!document.hidden) pull(); }, 20000);
  }

  /* ---------- קביעת מזהה הפנסיון (multi-tenancy) ---------- */
  const isOwnerPage = () => !!document.getElementById('owner-app');
  function ownerKennelId() {
    try {
      const u = JSON.parse(localStorage.getItem('boardog.owner') || 'null');
      return (u && u.sub) ? ('k_' + u.sub) : null;
    } catch (e) { return null; }
  }
  function resolveKennelId() {
    if (isOwnerPage()) return ownerKennelId(); // צד בעלים: לפי חשבון Google המחובר
    // צד לקוח: פרמטר בכתובת (?k=) → זיכרון → אותו מכשיר שבו הבעלים מחובר → ברירת מחדל
    let k = null;
    try { k = new URLSearchParams(location.search).get('k'); } catch (e) {}
    if (k) { try { localStorage.setItem('boardog.custKennel', k); } catch (e) {} return k; }
    try { k = localStorage.getItem('boardog.custKennel'); } catch (e) {}
    return k || ownerKennelId() || 'jerry';
  }

  function startWith(kid) {
    if (sb || !kid) return; // כבר אותחל / אין מזהה עדיין
    KENNEL_ID = kid;
    if (window.BoarDogCloud) window.BoarDogCloud.kennelId = kid;
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
    seedIfEmpty().then(pull).then(() => { subscribe(); startAutoRefresh(); });
  }

  function init() {
    if (!window.supabase || !window.supabase.createClient) return; // אין רשת/CDN – ממשיכים מקומית
    const kid = resolveKennelId();
    if (kid) startWith(kid);
    // בצד הבעלים לפני התחברות — מחכים לאירוע ההתחברות ואז מאתחלים
    else document.addEventListener('boardog:owner-auth', () => startWith(resolveKennelId()));
  }
  // ניקוי מלא של היומן (פגישות, שהיות, דוחות) — מקומי + שרת. זמינות ומאפיינים נשמרים.
  async function clearAll() {
    [K.meet, K.board, K.sum].forEach(k => setLocal(k, []));
    emit();
    if (sb) {
      try {
        await sb.from('meetings').delete().eq('kennel', KENNEL_ID);
        await sb.from('boardings').delete().eq('kennel', KENNEL_ID);
        await sb.from('summaries').delete().eq('kennel', KENNEL_ID);
      } catch (e) {}
    }
  }

  // קישור לצד הלקוח עם מזהה הפנסיון (לשיתוף / לבדיקה בין מכשירים)
  function customerLink() {
    const base = location.href.replace(/owner\.html.*$/, 'index.html').replace(/[?#].*$/, '');
    return KENNEL_ID ? (base + '?k=' + encodeURIComponent(KENNEL_ID)) : '';
  }
  // חשיפה לרענון יזום + שליחת הודעה ללקוח + ניקוי יומן (מדשבורד הבעלים)
  window.BoarDogCloud = { refresh: pull, sendCustomerMessage: sendCustomerMessage, clearAll: clearAll, kennelId: KENNEL_ID, customerLink: customerLink };
  document.addEventListener('DOMContentLoaded', init);
})();
