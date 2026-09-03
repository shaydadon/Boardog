/* =============================================================
   BoarDog – סנכרון דרך שרת הנתונים (boardog-data Worker)
   אין יותר גישת anon ישירה ל-Supabase: כל קריאה/כתיבה עוברת דרך
   שרת הנתונים שמאמת ומגביל לפי תפקיד (בעלים/לקוח). מקומי-קודם:
   הכתיבה נשמרת מיד ב-localStorage, והדחיפה לשרת היא best-effort.
   ============================================================= */
(function () {
  'use strict';

  const DATA_URL = 'https://boardog-data.shaydadon.workers.dev';
  const K = { avail: 'boardog.availability', meet: 'boardog.meetings', board: 'boardog.boardings', prof: 'boardog.profile', sum: 'boardog.summaries' };
  const S = window.BoarDogStore;
  if (!S) return;

  const setLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const getLocal = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } };
  const emit = () => document.dispatchEvent(new CustomEvent('boardog:sync'));

  let KENNEL_ID = null;
  let MYID = (S.customerId ? S.customerId() : null);
  let ready = false;
  const isOwnerPage = () => !!document.getElementById('owner-app');

  async function api(action, extra) {
    if (!KENNEL_ID) throw new Error('no kennel');
    const headers = { 'content-type': 'application/json' };
    if (isOwnerPage()) {
      const t = window.BoarDogOwnerAuth && window.BoarDogOwnerAuth.token && window.BoarDogOwnerAuth.token();
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    const body = Object.assign({ action: action, kennel: KENNEL_ID, customerId: MYID }, extra || {});
    const r = await fetch(DATA_URL, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    if (!r.ok) { const e = new Error('data ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  const fire = (action, extra) => { try { if (ready) api(action, extra).catch(() => {}); } catch (e) {} };

  /* ---------- עטיפת פעולות הכתיבה של המאגר → דחיפה לשרת ---------- */
  const _setAvail = S.setAvailability.bind(S);
  S.setAvailability = function (cfg) { _setAvail(cfg); fire('set_availability', { config: cfg }); };

  const _setProfile = S.setProfile.bind(S);
  S.setProfile = function (p) { _setProfile(p); fire('set_profile', { data: p || {} }); };

  const _addMeeting = S.addMeeting.bind(S);
  S.addMeeting = function (m) { const rec = _addMeeting(m); fire('upsert', { table: 'meetings', rec: rec }); return rec; };

  const _addBoarding = S.addBoarding.bind(S);
  S.addBoarding = function (b) { const rec = _addBoarding(b); fire('upsert', { table: 'boardings', rec: rec }); return rec; };

  const _updateMeeting = S.updateMeeting.bind(S);
  S.updateMeeting = function (rec) { const out = _updateMeeting(rec); const full = S.meetings().find(m => m.id === (rec && rec.id)); if (full) fire('upsert', { table: 'meetings', rec: full }); return out; };

  const _updateBoarding = S.updateBoarding.bind(S);
  S.updateBoarding = function (rec) { const out = _updateBoarding(rec); const full = S.boardings().find(b => b.id === (rec && rec.id)); if (full) fire('upsert', { table: 'boardings', rec: full }); return out; };

  const _saveSummary = S.saveSummary.bind(S);
  S.saveSummary = function (data) { const rec = _saveSummary(data); if (rec) fire('save_summary', { rec: rec }); return rec; };

  const _removeMeeting = S.removeMeeting.bind(S);
  S.removeMeeting = function (id) { _removeMeeting(id); fire('delete', { table: 'meetings', id: id }); };

  const _removeBoarding = S.removeBoarding.bind(S);
  S.removeBoarding = function (id) { _removeBoarding(id); fire('delete', { table: 'boardings', id: id }); };

  /* ---------- משיכה מהשרת → מקומי → רענון מסך ---------- */
  async function pull() {
    if (!ready) return;
    try {
      const d = await api('pull');
      if (d.availability) setLocal(K.avail, d.availability);
      if (Array.isArray(d.meetings)) setLocal(K.meet, d.meetings);
      if (Array.isArray(d.boardings)) setLocal(K.board, d.boardings);
      if (d.profile) setLocal(K.prof, d.profile);
      if (Array.isArray(d.summaries)) setLocal(K.sum, d.summaries);
      emit();
    } catch (e) {}
  }

  /* ---------- זריעה ראשונית של נתונים מקומיים לפנסיון החדש (בעלים) ---------- */
  async function seedIfEmpty() {
    if (!isOwnerPage()) return;
    try {
      const d = await api('pull');
      if (!d.availability) await api('set_availability', { config: getLocal(K.avail, null) || S.availability() });
      if (!d.profile && getLocal(K.prof, null)) await api('set_profile', { data: getLocal(K.prof, {}) });
      if (!d.meetings || !d.meetings.length) { for (const rec of getLocal(K.meet, [])) await api('upsert', { table: 'meetings', rec: rec }); }
      if (!d.boardings || !d.boardings.length) { for (const rec of getLocal(K.board, [])) await api('upsert', { table: 'boardings', rec: rec }); }
      if (!d.summaries || !d.summaries.length) { for (const rec of getLocal(K.sum, [])) await api('save_summary', { rec: rec }); }
    } catch (e) {}
  }

  /* ---------- תיבת דואר של הלקוח ---------- */
  async function pollInbox() {
    if (isOwnerPage() || !ready || !MYID) return;
    try {
      const d = await api('inbox');
      (d.messages || []).forEach(mm => { if (mm && mm.text) S.pushCustomerMsg(mm.text, mm.id); });
      document.dispatchEvent(new CustomEvent('boardog:inbox'));
    } catch (e) {}
  }
  function sendCustomerMessage(customerId, id, text) { return api('send_customer_message', { customerId: customerId, id: id, text: text }).catch(() => {}); }

  async function clearAll() {
    [K.meet, K.board, K.sum].forEach(k => setLocal(k, []));
    emit();
    try { await api('clear'); } catch (e) {}
  }

  /* ---------- רשתות ביטחון (polling — אין realtime בלי anon) ---------- */
  function startAutoRefresh() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { pull(); pollInbox(); } });
    window.addEventListener('focus', () => { pull(); pollInbox(); });
    setInterval(() => { if (!document.hidden) { pull(); pollInbox(); } }, 15000);
  }

  /* ---------- קביעת מזהה הפנסיון (multi-tenancy) ---------- */
  function ownerKennelId() {
    try { const u = JSON.parse(localStorage.getItem('boardog.owner') || 'null'); return (u && u.sub) ? ('k_' + u.sub) : null; } catch (e) { return null; }
  }
  function resolveKennelId() {
    if (isOwnerPage()) return ownerKennelId();
    let k = null;
    try { k = new URLSearchParams(location.search).get('k'); } catch (e) {}
    if (k) { try { localStorage.setItem('boardog.custKennel', k); } catch (e) {} return k; }
    try { k = localStorage.getItem('boardog.custKennel'); } catch (e) {}
    return k || ownerKennelId() || 'jerry';
  }

  function startWith(kid) {
    if (ready || !kid) return;
    KENNEL_ID = kid; ready = true;
    if (window.BoarDogCloud) window.BoarDogCloud.kennelId = kid;
    seedIfEmpty().then(pull).then(() => { startAutoRefresh(); pollInbox(); });
  }

  function init() {
    const kid = resolveKennelId();
    if (kid) startWith(kid);
    else document.addEventListener('boardog:owner-auth', () => startWith(resolveKennelId()));
  }

  function customerLink() {
    const base = location.href.replace(/owner\.html.*$/, 'index.html').replace(/[?#].*$/, '');
    return KENNEL_ID ? (base + '?k=' + encodeURIComponent(KENNEL_ID)) : '';
  }

  window.BoarDogCloud = { refresh: pull, sendCustomerMessage: sendCustomerMessage, clearAll: clearAll, kennelId: KENNEL_ID, customerLink: customerLink };
  document.addEventListener('DOMContentLoaded', init);
})();
