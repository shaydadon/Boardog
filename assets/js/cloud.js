/* =============================================================
   BoarDog – סנכרון דרך שרת הנתונים (boardog-data Worker)
   אין יותר גישת anon ישירה ל-Supabase: כל קריאה/כתיבה עוברת דרך
   שרת הנתונים שמאמת ומגביל לפי תפקיד (בעלים/לקוח). מקומי-קודם:
   הכתיבה נשמרת מיד ב-localStorage, והדחיפה לשרת היא best-effort.
   ============================================================= */
(function () {
  'use strict';

  const DATA_URL = 'https://boardog-data.shaydadon.workers.dev';
  // פנסיון ברירת המחדל של הפריסה הזו (התקנת פנסיון יחיד): הלקוח/ה-PWA ייכנסו
  // אליו אוטומטית בלי מסך חיבור. לפריסה רב-דיירית (מכירה) — רוקן את הערך ('')
  // ואז לקוח בלי קישור ?k= יראה מסך "התחברות לפנסיון".
  const DEFAULT_KENNEL = 'k_111331881799600698826';
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

  const ownerToken = () => (window.BoarDogOwnerAuth && window.BoarDogOwnerAuth.token && window.BoarDogOwnerAuth.token()) || null;
  // ממתין עד שיש טוקן Google תקף (בדף הבעלים) — מונע מרוץ שבו כתיבת הבעלים
  // הראשונה יוצאת לפני רענון הטוקן ונדחית ב-403.
  async function waitForOwnerToken(ms) {
    if (!isOwnerPage() || ownerToken()) return;
    try { window.BoarDogOwnerAuth && window.BoarDogOwnerAuth.refresh && window.BoarDogOwnerAuth.refresh(); } catch (e) {}
    const end = Date.now() + (ms || 6000);
    while (Date.now() < end) { if (ownerToken()) return; await new Promise(r => setTimeout(r, 300)); }
  }

  async function api(action, extra) {
    if (!KENNEL_ID) throw new Error('no kennel');
    const send = () => {
      const headers = { 'content-type': 'application/json' };
      if (isOwnerPage()) { const t = ownerToken(); if (t) headers['Authorization'] = 'Bearer ' + t; }
      const body = Object.assign({ action: action, kennel: KENNEL_ID, customerId: MYID }, extra || {});
      return fetch(DATA_URL, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    };
    let r = await send();
    // 403 בדף הבעלים = טוקן פג/טרם מוכן → רענון והזרקה חוזרת פעם אחת
    if (r.status === 403 && isOwnerPage()) { await waitForOwnerToken(6000); r = await send(); }
    if (!r.ok) { const e = new Error('data ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  /* ---------- תור סנכרון עמיד (outbox) — אף כתיבה לא אובדת ---------- */
  // כל פעולת כתיבה נשמרת בתור מתמשך ב-localStorage ומנוסה שוב ושוב עד
  // שהיא באמת מגיעה לשרת (גם אחרי כישלון רשת / טעינה / חוסר חיבור).
  const OUTBOX = 'boardog.outbox';
  const loadOutbox = () => getLocal(OUTBOX, []);
  const saveOutbox = (q) => setLocal(OUTBOX, q);
  function opKey(action, extra) {
    extra = extra || {};
    if (action === 'upsert') return 'upsert:' + extra.table + ':' + (extra.rec && extra.rec.id);
    if (action === 'save_summary') return 'save_summary:' + (extra.rec && extra.rec.id);
    if (action === 'delete') return 'delete:' + extra.table + ':' + extra.id;
    if (action === 'set_availability') return 'set_availability';
    if (action === 'set_profile') return 'set_profile';
    return action + ':' + Date.now() + ':' + Math.random();
  }
  function enqueue(action, extra) {
    const q = loadOutbox();
    const key = opKey(action, extra);
    // מחיקה של רשומה מבטלת upsert ממתין לאותה רשומה (לא ליצור מחדש מה שנמחק)
    if (action === 'delete') {
      const uk = 'upsert:' + (extra && extra.table) + ':' + (extra && extra.id);
      for (let i = q.length - 1; i >= 0; i--) if (q[i].id === uk) q.splice(i, 1);
    }
    const item = { id: key, action: action, extra: extra || {}, ts: Date.now() };
    const i = q.findIndex(x => x.id === key);
    if (i >= 0) q[i] = item; else q.push(item);
    saveOutbox(q);
    flush();
  }
  let flushing = false;
  async function flush() {
    if (!ready || flushing) return;
    flushing = true;
    try {
      let q = loadOutbox();
      while (q.length) {
        const item = q[0];
        try { await api(item.action, item.extra); }
        catch (e) { break; } // כישלון → משאירים בתור, ננסה שוב מאוחר יותר
        q = loadOutbox().filter(x => x.id !== item.id);
        saveOutbox(q);
      }
    } finally { flushing = false; }
  }
  const fire = (action, extra) => enqueue(action, extra);

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
  let firstPull = true;
  async function pull() {
    if (!ready) return;
    try {
      const d = await api('pull');
      // הגנה: בטעינה הראשונה אל תמחק נתונים מקומיים אם השרת עדיין ריק
      // (טננט חדש / לא מסונכרן / השרת טרם זיהה את הבעלים)
      const keep = (arr, key) => {
        if (firstPull && (!arr || !arr.length) && getLocal(key, []).length) return;
        if (Array.isArray(arr)) setLocal(key, arr);
      };
      if (d.availability) setLocal(K.avail, d.availability);
      if (d.profile) setLocal(K.prof, d.profile);
      keep(d.meetings, K.meet);
      keep(d.boardings, K.board);
      keep(d.summaries, K.sum);
      firstPull = false;
      emit();
    } catch (e) {}
  }

  /* ---------- פיוס מקומי→שרת: כל רשומה מקומית נדחפת לתור (idempotent) ----------
     מבטיח שאף פגישה שנשמרה מקומית לא "תיתקע" ולא תגיע ליומן. חייב לרוץ לפני
     ה-pull הראשון כדי לתפוס רשומות מקומיות לפני שהמשיכה מהשרת דורסת אותן. */
  function reconcileLocal() {
    const mineM = (m) => isOwnerPage() || !MYID || String((m && m.customerId) || '') === String(MYID);
    getLocal(K.meet, []).forEach(m => { if (m && m.id && mineM(m)) enqueue('upsert', { table: 'meetings', rec: m }); });
    getLocal(K.board, []).forEach(b => { if (b && b.id && mineM(b)) enqueue('upsert', { table: 'boardings', rec: b }); });
    getLocal(K.sum, []).forEach(s => { if (s && s.id && mineM(s)) enqueue('save_summary', { rec: s }); });
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

  /* ---------- רשתות ביטחון (polling + ריקון התור) ---------- */
  function startAutoRefresh() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); pull(); pollInbox(); } });
    window.addEventListener('focus', () => { flush(); pull(); pollInbox(); });
    window.addEventListener('online', () => { flush(); pull(); });
    setInterval(() => { if (!document.hidden) { flush(); pull(); pollInbox(); } }, 12000);
  }

  /* ---------- קביעת מזהה הפנסיון (multi-tenancy) ---------- */
  function ownerKennelId() {
    try { const u = JSON.parse(localStorage.getItem('boardog.owner') || 'null'); return (u && u.sub) ? ('k_' + u.sub) : null; } catch (e) { return null; }
  }
  function resolveKennelId() {
    if (isOwnerPage()) return ownerKennelId();
    // 1) קישור מפורש (?k=) תמיד מנצח ונשמר לפעם הבאה
    let k = null;
    try { k = new URLSearchParams(location.search).get('k'); } catch (e) {}
    if (k) { try { localStorage.setItem('boardog.custKennel', k); } catch (e) {} return k; }
    // 2) בעלים מחובר על אותו מכשיר (בדיקה עצמית של תצוגת הלקוח) — קודם לכל cache ישן
    const own = ownerKennelId();
    if (own) return own;
    // 3) הקישור האחרון ששימש במכשיר הזה (נדבק אחרי חיבור ראשון)
    try { k = localStorage.getItem('boardog.custKennel'); } catch (e) {}
    // ברירת מחדל של הפריסה (פנסיון יחיד) אם מוגדרת; אחרת null → מסך חיבור
    return k || DEFAULT_KENNEL || null;
  }

  // חילוץ מזהה פנסיון מקישור מלא / ?k=... / קוד גולמי (k_...)
  function parseKennel(input) {
    input = (input || '').trim();
    if (!input) return null;
    try { const u = new URL(input); const kk = new URLSearchParams(u.search).get('k'); if (kk) return kk; } catch (e) {}
    const m = input.match(/[?&]k=([^&#\s]+)/); if (m) return decodeURIComponent(m[1]);
    if (/^k_[\w-]+$/.test(input)) return input;
    return null;
  }

  // מסך חיבור חד-פעמי ללקוח שאין לו מזהה פנסיון (במקום נפילה ל-jerry)
  function showConnect() {
    if (document.getElementById('bd-connect')) return;
    const wrap = document.createElement('div');
    wrap.id = 'bd-connect';
    wrap.setAttribute('style', 'position:fixed;inset:0;z-index:9999;background:#efeae2;display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit;');
    wrap.innerHTML =
      '<div style="max-width:360px;width:100%;background:#fff;border-radius:18px;padding:28px 22px;box-shadow:0 10px 40px rgba(0,0,0,.12);text-align:center;">' +
      '<img src="assets/logo.jpg" alt="" style="width:84px;height:84px;border-radius:20px;object-fit:cover;margin:0 auto 14px;display:block;" onerror="this.style.display=\'none\'"/>' +
      '<h2 style="margin:0 0 6px;font-size:20px;color:#075e54;">התחברות לפנסיון</h2>' +
      '<p style="margin:0 0 16px;color:#555;font-size:14px;line-height:1.5;">הדביקו את הקישור שקיבלתם מהפנסיון כדי להתחיל. נשמר במכשיר — פעם אחת בלבד.</p>' +
      '<input id="bd-connect-input" type="text" inputmode="url" placeholder="הדביקו קישור או קוד פנסיון" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #ccc;border-radius:12px;font-size:15px;text-align:center;margin-bottom:10px;"/>' +
      '<div id="bd-connect-err" style="color:#c0392b;font-size:13px;min-height:18px;margin-bottom:6px;"></div>' +
      '<button id="bd-connect-go" style="width:100%;padding:12px;background:#075e54;color:#fff;border:0;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;">התחבר</button>' +
      '</div>';
    document.body.appendChild(wrap);
    const go = function () {
      const k = parseKennel(document.getElementById('bd-connect-input').value);
      if (!k) { document.getElementById('bd-connect-err').textContent = 'קישור לא תקין — ודאו שהעתקתם את הקישור המלא'; return; }
      try { localStorage.setItem('boardog.custKennel', k); } catch (e) {}
      location.reload();
    };
    document.getElementById('bd-connect-go').addEventListener('click', go);
    document.getElementById('bd-connect-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  }

  // בידוד דיירים: localStorage משותף בין חשבונות Google באותו דפדפן. אם המטמון
  // המקומי שייך לפנסיון אחר (החלפת חשבון/קישור) — מנקים אותו לגמרי לפני סנכרון,
  // אחרת דייר אחד יראה (ואף יעלה לשרת) את הנתונים של דייר אחר.
  function scopeLocalToKennel(kid) {
    let prev = null;
    try { prev = localStorage.getItem('boardog.localKennel'); } catch (e) {}
    if (prev && prev !== kid) {
      [K.avail, K.meet, K.board, K.prof, K.sum, OUTBOX].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      firstPull = true;
    }
    try { localStorage.setItem('boardog.localKennel', kid); } catch (e) {}
  }

  function startWith(kid) {
    if (ready || !kid) return;
    KENNEL_ID = kid; ready = true;
    scopeLocalToKennel(kid);   // בידוד דיירים — לפני כל סנכרון
    if (window.BoarDogCloud) window.BoarDogCloud.kennelId = kid;
    // בדף הבעלים ממתינים לטוקן תקף לפני זריעה, אחרת הכתיבה הראשונה נדחית.
    // reconcileLocal רץ לפני pull — תופס רשומות מקומיות תקועות לפני שהמשיכה דורסת.
    waitForOwnerToken(6000)
      .then(seedIfEmpty)
      .then(() => { reconcileLocal(); return flush(); })
      .then(pull)
      .then(() => { startAutoRefresh(); pollInbox(); });
  }

  function init() {
    const kid = resolveKennelId();
    if (kid) { startWith(kid); return; }
    if (isOwnerPage()) { document.addEventListener('boardog:owner-auth', () => startWith(resolveKennelId())); return; }
    showConnect();   // לקוח בלי מזהה פנסיון → מסך חיבור (לא נופלים ל-jerry)
  }

  function customerLink() {
    const base = location.href.replace(/owner\.html.*$/, 'index.html').replace(/[?#].*$/, '');
    return KENNEL_ID ? (base + '?k=' + encodeURIComponent(KENNEL_ID)) : '';
  }

  window.BoarDogCloud = { refresh: pull, sendCustomerMessage: sendCustomerMessage, clearAll: clearAll, kennelId: KENNEL_ID, customerLink: customerLink };
  document.addEventListener('DOMContentLoaded', init);
})();
