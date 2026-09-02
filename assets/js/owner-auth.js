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
    const acc = { email: u.email || '', name: u.name || '', picture: u.picture || '', sub: u.sub || '' };
    set(acc); showApp(acc);
  }
  function signOut() {
    clear();
    try { if (global.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
    showLogin();
  }

  global.BoarDogOwnerAuth = { user: get, signOut: signOut };

  document.addEventListener('DOMContentLoaded', function () {
    const so = document.getElementById('owner-signout');
    if (so) so.addEventListener('click', signOut);
    if (get()) showApp(get()); else showLogin();
  });
})(window);
