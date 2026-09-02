/* =============================================================
   BoarDog – סנכרון פגישות ושהיות ליומן Google (צד הבעלים)
   דוחף פגישות היכרות (אירוע מתוזמן) ושהיות (אירוע רב-יומי) ליומן
   Google של הבעלים, כל אחד עם תזכורת מייל + פופאפ מובנית מ-Google.
   מבוסס Google Identity Services + Calendar REST API.
   ============================================================= */
(function () {
  'use strict';

  // Client ID מוטמע (ברירת מחדל למוצר) — לא סוד, גלוי ממילא בדף. כשמוגדר,
  // הבעלים לא רואה שדה כלל, רק כפתור סנכרון. אפשר לדרוס דרך localStorage.
  const DEFAULT_CLIENT_ID = '372588686007-8qmm1i1jgtfipfmbcqrsh1g2p01tp6gb.apps.googleusercontent.com';
  const CID_KEY = 'boardog.gcalClient';
  const MAP_KEY = 'boardog.gcalMap';       // { 'm:<id>'|'b:<id>': eventId }
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
  const tz = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'; } catch (e) { return 'Asia/Jerusalem'; } })();

  let token = null, tokenExp = 0, tokenClient = null;

  const clientId = () => { try { return localStorage.getItem(CID_KEY) || DEFAULT_CLIENT_ID; } catch (e) { return DEFAULT_CLIENT_ID; } };
  const setClientId = (v) => { try { localStorage.setItem(CID_KEY, v || ''); } catch (e) {} };
  const loadMap = () => { try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch (e) { return {}; } };
  const saveMap = (m) => { try { localStorage.setItem(MAP_KEY, JSON.stringify(m)); } catch (e) {} };
  const pad = (n) => String(n).padStart(2, '0');
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  function loadGIS() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('gis-load'));
      document.head.appendChild(s);
    });
  }

  function getToken() {
    return new Promise(async (resolve, reject) => {
      const cid = clientId();
      if (!cid) return reject(new Error('no-client-id'));
      if (token && Date.now() < tokenExp - 60000) return resolve(token);
      try { await loadGIS(); } catch (e) { return reject(e); }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cid, scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) { token = resp.access_token; tokenExp = Date.now() + (resp.expires_in || 3600) * 1000; resolve(token); }
          else reject(new Error('no-token'));
        },
        error_callback: (e) => reject(new Error((e && e.type) || 'auth-error'))
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  async function api(method, path, body) {
    const t = await getToken();
    const r = await fetch('https://www.googleapis.com/calendar/v3' + path, {
      method,
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) { if (r.status === 401) token = null; const e = new Error('gcal ' + r.status); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }

  function toEvent(item) {
    if (item.allDay) {
      return {
        summary: item.title, description: item.description || '',
        start: { date: item.start }, end: { date: addDays(item.end, 1) }, // סוף בלעדי ביומן Google
        reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 1440 }, { method: 'popup', minutes: 600 }] },
        source: { title: 'BoarDog', url: location.origin + location.pathname }
      };
    }
    return {
      summary: item.title, description: item.description || '',
      start: { dateTime: item.startDateTime, timeZone: tz },
      end: { dateTime: item.endDateTime, timeZone: tz },
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 120 }, { method: 'popup', minutes: 60 }] },
      source: { title: 'BoarDog', url: location.origin + location.pathname }
    };
  }

  // items = רשומות עתידיות ליצירה; validKeys = כל המפתחות הקיימים כרגע (למחיקת אירועים של רשומות שנמחקו)
  async function sync(items, validKeys) {
    const map = loadMap();
    const valid = new Set(validKeys || items.map(i => i.key));
    let added = 0, removed = 0;
    for (const it of items) {
      if (map[it.key]) continue;
      const ev = await api('POST', '/calendars/primary/events', toEvent(it));
      if (ev && ev.id) { map[it.key] = ev.id; added++; saveMap(map); }
    }
    for (const key of Object.keys(map)) {
      if (!valid.has(key)) { // הרשומה נמחקה מהיומן של האפליקציה → מוחקים גם ביומן Google
        try { await api('DELETE', '/calendars/primary/events/' + encodeURIComponent(map[key])); } catch (e) {}
        delete map[key]; removed++; saveMap(map);
      }
    }
    return { added, removed };
  }

  const hasOverride = () => { try { return !!localStorage.getItem(CID_KEY); } catch (e) { return false; } };
  window.BoarDogGCal = { clientId, setClientId, sync, getToken, configured: () => !!clientId(), hasOverride };
})();
