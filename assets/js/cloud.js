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
  const KENNEL_ID = 'jerry';

  const K = { avail: 'boardog.availability', meet: 'boardog.meetings', board: 'boardog.boardings', prof: 'boardog.profile' };
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
      const [a, m, b, p] = await Promise.all([
        sb.from('availability').select('config').eq('id', KENNEL_ID).maybeSingle(),
        sb.from('meetings').select('data').eq('kennel', KENNEL_ID),
        sb.from('boardings').select('data').eq('kennel', KENNEL_ID),
        sb.from('kennel_profile').select('data').eq('id', KENNEL_ID).maybeSingle()
      ]);
      if (a.data && a.data.config) setLocal(K.avail, a.data.config);
      if (m.data) setLocal(K.meet, m.data.map(r => r.data).filter(Boolean));
      if (b.data) setLocal(K.board, b.data.map(r => r.data).filter(Boolean));
      if (p.data && p.data.data) setLocal(K.prof, p.data.data);
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
    } catch (e) {}
  }

  /* ---------- זמן אמת ---------- */
  function subscribe() {
    if (!sb) return;
    try {
      sb.channel('kennel-' + KENNEL_ID)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, pull)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'boardings' }, pull)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, pull)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kennel_profile' }, pull)
        .subscribe();
    } catch (e) {}
  }

  /* ---------- רשתות ביטחון לרענון (משלימות את ה-realtime) ---------- */
  function startAutoRefresh() {
    // חזרה לטאב / פוקוס → משיכה מיידית (מושלם למעבר בין טאב הבעלים לטאב הלקוח)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    window.addEventListener('focus', pull);
    // מרפא-עצמי: משיכה תקופתית אם ה-realtime החמיץ אירוע
    setInterval(() => { if (!document.hidden) pull(); }, 20000);
  }

  function init() {
    if (!window.supabase || !window.supabase.createClient) return; // אין רשת/CDN – ממשיכים מקומית
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
    seedIfEmpty().then(pull).then(() => { subscribe(); startAutoRefresh(); });
  }
  // חשיפה לרענון יזום (למשל לפני שהבוט מציע חלונות פנויים)
  window.BoarDogCloud = { refresh: pull };
  document.addEventListener('DOMContentLoaded', init);
})();
