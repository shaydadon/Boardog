/* =============================================================
   BoarDog – כניסת בעלי הפנסיון (Google Sign-In / GIS)
   שער כניסה לצד הבעלים בלבד (צד הלקוח מתנהל בוואטסאפ).
   מבוסס Google Identity Services — טוקן זהות בדפדפן, ללא שרת.
   ============================================================= */
(function (global) {
  'use strict';

  // אותו Client ID מוטמע כמו בסנכרון היומן (לא סוד, גלוי ממילא בדף).
  const CLIENT_ID = (global.BoarDogGCal && global.BoarDogGCal.clientId && global.BoarDogGCal.clientId())
    || '372588686007-8qmm1i1jgtfipfmbcqrsh1g2p01tp6gb.apps.googleusercontent.com';
  const KEY = 'boardog.owner';
  const DATA_URL = 'https://boardog-data.shaydadon.workers.dev';

  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const set = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  const clear = () => { try { localStorage.removeItem(KEY); } catch (e) {} };
  function decode(jwt) {
    try { return JSON.parse(decodeURIComponent(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''))); }
    catch (e) { return {}; }
  }

  let gisInit = false;
  function loadGIS(cb) {
    if (global.google && google.accounts && google.accounts.id) return cb();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = cb; s.onerror = () => {}; document.head.appendChild(s);
  }
  function renderButton() {
    loadGIS(function () {
      if (!global.google || !google.accounts || !google.accounts.id) return;
      if (!gisInit) { google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, auto_select: false }); gisInit = true; }
      const el = document.getElementById('g-signin');
      if (el) { el.innerHTML = ''; try { google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 260 }); } catch (e) {} }
      try { google.accounts.id.prompt(); } catch (e) {}
    });
  }

  function showApp(u) {
    const login = document.getElementById('owner-login'), app = document.getElementById('owner-app');
    if (login) login.hidden = true;
    if (app) app.hidden = false;
    document.dispatchEvent(new CustomEvent('boardog:owner-auth', { detail: u }));
  }
  function showLogin() {
    const login = document.getElementById('owner-login'), app = document.getElementById('owner-app');
    if (app) app.hidden = true;
    if (login) login.hidden = false;
    renderButton();
  }
  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    const u = decode(resp.credential);
    const prev = get() || {};
    const acc = { email: u.email || prev.email || '', name: u.name || prev.name || '', picture: u.picture || prev.picture || '', sub: u.sub || prev.sub || '', token: resp.credential, exp: u.exp || 0, sess: prev.sess || '', sessExp: prev.sessExp || 0 };
    set(acc);
    showApp(acc);
    // החלפת טוקן Google בטוקן סשן ארוך-טווח (30 יום) — פעם אחת בהתחברות
    exchangeSession(resp.credential).then(function () { document.dispatchEvent(new CustomEvent('boardog:owner-token')); });
    document.dispatchEvent(new CustomEvent('boardog:owner-token'));
  }
  // החלפת טוקן Google בטוקן סשן חתום מהשרת (מבטל את מגבלת השעה של Google)
  async function exchangeSession(googleToken) {
    try {
      const r = await fetch(DATA_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + googleToken }, body: JSON.stringify({ action: 'session' }) });
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.token) { const u = get() || {}; u.sess = d.token; u.sessExp = d.exp || 0; set(u); }
    } catch (e) {}
  }
  const valid = (exp) => exp && (exp * 1000 > Date.now() + 60000);
  // הטוקן לאימות מול השרת: מעדיפים סשן ארוך-טווח, נופלים לטוקן Google תקף.
  function token() {
    const u = get();
    if (u && u.sess && valid(u.sessExp)) return u.sess;
    if (u && u.token && valid(u.exp)) return u.token;
    return null;
  }
  // מוודא שיש סשן פעיל: אם הסשן תקף — סיום; אם יש טוקן Google תקף — החלפה;
  // אחרת — רענון שקט (One Tap), וכמוצא אחרון הצגת מסך הכניסה מחדש.
  async function ensureSession() {
    const u = get();
    if (u && u.sess && valid(u.sessExp)) return;              // סשן תקף — הכול טוב
    if (u && u.token && valid(u.exp)) { await exchangeSession(u.token); return; } // החלפה
    refresh();                                                 // ניסיון שקט
    setTimeout(function () { if (!token()) showLogin(); }, 4000); // נכשל — כניסה מחדש
  }
  // רענון שקט של הטוקן (One Tap) — נקרא תקופתית וכשהטוקן עומד לפוג
  function refresh() {
    loadGIS(function () {
      if (!global.google || !google.accounts || !google.accounts.id) return;
      if (!gisInit) { google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, auto_select: true }); gisInit = true; }
      try { google.accounts.id.prompt(); } catch (e) {}
    });
  }
  function signOut() {
    clear();
    try { if (global.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
    try { localStorage.removeItem('boardog.custKennel'); } catch (e) {}
    location.reload(); // איפוס נקי — קליינט Supabase יאותחל מחדש עם/בלי הפנסיון
  }

  global.BoarDogOwnerAuth = { user: get, token: token, refresh: refresh, signOut: signOut };

  document.addEventListener('DOMContentLoaded', function () {
    const so = document.getElementById('owner-signout');
    if (so) so.addEventListener('click', signOut);
    if (get()) {
      showApp(get());
      ensureSession();                          // סשן תקף / החלפה / כניסה מחדש
      setInterval(function () { if (!token()) ensureSession(); }, 5 * 60 * 1000);
    } else showLogin();
  });
})(window);
