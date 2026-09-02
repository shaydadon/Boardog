/* =============================================================
   BoarDog – אפליקציית בעל הפנסיון
   זמינות שבועית · יומן פגישות ושהיות · שאילתת AI "כמה כלבים בתקופה"
   ============================================================= */
(function () {
  'use strict';
  const S = window.BoarDogStore;
  const $ = s => document.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const KENNEL_NAME = 'הפנסיון של ג׳רי · שי';
  const HOURS = [8, 10, 12, 14, 16, 18, 20];
  const DOW = S.DOW;
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  let viewDate = new Date();
  const seen = { meet: new Set(), board: new Set() };

  // הדוח של אירוע ספציפי: קודם התמונה שהוצמדה לאירוע; גיבוי — דוח לפי לקוח,
  // אך רק אם שם הבעלים/הכלב תואם (מונע הצגת דוח של לקוח אחר במכשיר משותף)
  function eventSummary(rec) {
    if (!rec) return null;
    if (rec.summary) return rec.summary;
    if (rec.customerId && S.getSummary) {
      const s = S.getSummary(rec.customerId);
      if (s && (!rec.ownerName || !s.ownerName || norm(s.ownerName) === norm(rec.ownerName)) &&
               (!rec.dogName || !s.dogName || norm(s.dogName) === norm(rec.dogName))) return s;
    }
    return null;
  }
  function openReport(sum) {
    if (sum && window.BoarDogReport) window.BoarDogReport.openModal(sum);
    else toast('אין עדיין דוח קליטה לאירוע זה');
  }

  // התראה חיה על לידים/שריונים חדשים שנכנסו מהשרת
  function scanNew(initial) {
    const meets = S.meetings(), boards = S.boardings();
    const newMeets = meets.filter(m => !seen.meet.has(m.id));
    const newBoards = boards.filter(b => !seen.board.has(b.id));
    meets.forEach(m => seen.meet.add(m.id));
    boards.forEach(b => seen.board.add(b.id));
    if (initial) return;
    if (newMeets.length) { const m = newMeets[newMeets.length - 1]; toast(`🔔 ליד חדש: פגישת היכרות עם ${m.ownerName || 'לקוח'} ${m.dogName ? '(' + m.dogName + ')' : ''}`); }
    else if (newBoards.length) { const b = newBoards[newBoards.length - 1]; toast(`🔔 שריון שהייה: ${b.ownerName || 'לקוח'} · ${b.start}→${b.end}`); }
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /* ---------- טאבים ---------- */
  function initTabs() {
    document.querySelectorAll('.otab').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.otab').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.opanel').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.otab; });
      if (b.dataset.otab === 'cal') renderCalendar();
      if (b.dataset.otab === 'profile') loadProfile();
      if (b.dataset.otab === 'revenue') renderRevenue();
      if (b.dataset.otab === 'ask') renderAiUsage();
    }));
  }

  /* ---------- זמינות ---------- */
  function renderAvail() {
    const avail = S.availability();
    const grid = $('#avail-grid');
    grid.innerHTML = '';
    for (let wd = 0; wd <= 5; wd++) { // ראשון–שישי
      const row = document.createElement('div');
      row.className = 'avail-row';
      const on = avail[wd] || [];
      row.innerHTML = `<div class="avail-day">${DOW[wd]}</div>` +
        `<div class="avail-hours">` + HOURS.map(h =>
          `<button class="hchip ${on.indexOf(h) !== -1 ? 'on' : ''}" data-wd="${wd}" data-h="${h}">${pad(h)}:00</button>`
        ).join('') + `</div>`;
      grid.appendChild(row);
    }
    grid.querySelectorAll('.hchip').forEach(c => c.addEventListener('click', () => c.classList.toggle('on')));
  }
  function saveAvail() {
    const cfg = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    document.querySelectorAll('.hchip.on').forEach(c => cfg[+c.dataset.wd].push(+c.dataset.h));
    Object.keys(cfg).forEach(k => cfg[k].sort((a, b) => a - b));
    S.setAvailability(cfg);
    toast('הזמינות נשמרה ✓');
  }

  /* ---------- יומן ---------- */
  function renderCalendar() {
    const y = viewDate.getFullYear(), mo = viewDate.getMonth();
    const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    $('#cal-month').textContent = `${MONTHS[mo]} ${y}`;
    const grid = $('#ocal-grid');
    grid.innerHTML = '';
    ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].forEach(n => { const d = document.createElement('div'); d.className = 'ocal-dow'; d.textContent = n; grid.appendChild(d); });
    const first = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    for (let i = 0; i < first; i++) grid.appendChild(document.createElement('div'));
    const todayK = S.key(new Date());
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, mo, d), dk = S.key(date);
      const meets = S.meetingsOn(date), boards = S.boardingsOn(date);
      const cell = document.createElement('button');
      cell.className = 'ocal-cell' + (dk === todayK ? ' today' : '') + (meets.length ? ' has-meet' : '') + (boards.length ? ' has-board' : '');
      cell.innerHTML = `<span class="cd">${d}</span>` +
        (boards.length ? `<span class="cb board">🏠${boards.length}</span>` : '') +
        (meets.length ? `<span class="cb meet">📋${meets.length}</span>` : '');
      cell.addEventListener('click', () => showDay(date, meets, boards));
      grid.appendChild(cell);
    }
    $('#day-detail').innerHTML = '';
  }
  function showDay(date, meets, boards) {
    const box = $('#day-detail');
    if (!meets.length && !boards.length) { box.innerHTML = `<div class="dd-empty">אין פגישות או שהיות ב-${S.key(date)}</div>`; return; }
    box.innerHTML = `<div class="dd-title">${DOW[date.getDay()]} · ${S.key(date)}</div>` +
      meets.map(m => {
        const done = S.meetingFulfilled(m.id);
        const req = m.requestedStart ? `<div class="dd-req">🗓️ מבוקש ע״י הלקוח: ${esc(m.requestedStart)} → ${esc(m.requestedEnd)}</div>` : '';
        const rBtn = eventSummary(m) ? `<button class="report-btn" data-report-meet="${esc(m.id)}">📋 דוח קליטה</button>` : '';
        return `<div class="dd-row meet">📋 פגישת היכרות ${m.time} — ${esc(m.dogName)} (${esc(m.ownerName)}) ` +
          `<button class="del-btn" title="מחק פגישה" data-del-meet="${esc(m.id)}">🗑</button>` + rBtn +
          (done ? `<span class="dd-tag ok">✓ תאריכים שוריינו</span>`
                : `<span class="dd-tag wait">⏳ ממתין לתאריכים</span>` + req +
                  `<div class="dd-reserve"><button class="mini-btn" data-mid="${esc(m.id)}">＋ שריין תאריכי שהייה</button></div>`) +
          `</div>`;
      }).join('') +
      boards.map(b => {
        const multi = b.start !== b.end;
        const rBtn = eventSummary(b) ? `<button class="report-btn" data-report-board="${esc(b.id)}">📋 דוח קליטה</button>` : '';
        return `<div class="dd-row board">🏠 שהייה — ${esc(b.dogName)} (${esc(b.ownerName)}) · ${b.start}→${b.end}` + rBtn +
          `<div class="dd-del">` +
          (multi ? `<button class="del-btn" data-del-day="${esc(b.id)}">🗑 יום זה (${S.key(date)})</button>` : '') +
          `<button class="del-btn" data-del-board="${esc(b.id)}">🗑 כל השהייה</button>` +
          `</div></div>`;
      }).join('');
    box.querySelectorAll('.mini-btn[data-mid]').forEach(btn =>
      btn.addEventListener('click', () => openReserve(btn, meets.find(m => m.id === btn.dataset.mid), date)));
    box.querySelectorAll('[data-report-meet]').forEach(btn =>
      btn.addEventListener('click', () => {
        const rec = meets.find(m => m.id === btn.dataset.reportMeet);
        openReport(eventSummary(rec));
      }));
    box.querySelectorAll('[data-report-board]').forEach(btn =>
      btn.addEventListener('click', () => {
        const rec = boards.find(b => b.id === btn.dataset.reportBoard);
        openReport(eventSummary(rec));
      }));
    box.querySelectorAll('[data-del-meet]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!confirm('למחוק את פגישת ההיכרות?')) return;
        const m = meets.find(x => x.id === btn.dataset.delMeet);
        S.removeMeeting(btn.dataset.delMeet);
        notifyCancel(m, `פגישת ההיכרות ל${m && m.time || ''} בוטלה`);
        toast(m && m.phone ? 'הפגישה נמחקה — נשלחה הודעה ללקוח ✓' : 'הפגישה נמחקה');
        refreshDay(date);
      }));
    box.querySelectorAll('[data-del-board]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!confirm('למחוק את כל השהייה?')) return;
        const b = boards.find(x => x.id === btn.dataset.delBoard);
        S.removeBoarding(btn.dataset.delBoard);
        notifyCancel(b, `השהייה (${b ? b.start + '→' + b.end : ''}) בוטלה`);
        toast(b && b.phone ? 'השהייה נמחקה — נשלחה הודעה ללקוח ✓' : 'השהייה נמחקה');
        refreshDay(date);
      }));
    box.querySelectorAll('[data-del-day]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!confirm('להסיר את היום הזה מהשהייה?')) return;
        const b = boards.find(x => x.id === btn.dataset.delDay);
        removeBoardingDay(btn.dataset.delDay, S.key(date));
        notifyCancel(b, `יום ${S.key(date)} הוסר מהשהייה`);
        toast(b && b.phone ? 'היום הוסר — נשלחה הודעה ללקוח ✓' : 'היום הוסר מהשהייה');
        refreshDay(date);
      }));
  }

  // הודעה ללקוח: בדמו → צ'אט הלקוח (תיבת דואר משותפת); במוצר → וואטסאפ דרך ה-Worker.
  const NOTIFY_KEY = 'boardog.notifyUrl';
  const notifyUrl = () => { try { return localStorage.getItem(NOTIFY_KEY) || ''; } catch (e) { return ''; } };
  function notifyCustomer(rec, body) {
    const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try { S.pushCustomerMsg(body, id); } catch (e) {}       // אותו דפדפן — מיידי
    // בין מכשירים — דרך Supabase לפי מזהה הלקוח
    const cid = rec && rec.customerId;
    if (cid && window.BoarDogCloud && window.BoarDogCloud.sendCustomerMessage) window.BoarDogCloud.sendCustomerMessage(cid, id, body);
    if (rec && rec.phone) {                                 // מוצר אמיתי — וואטסאפ
      const url = notifyUrl();
      if (url) fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: rec.phone, text: body }) }).catch(() => {});
    }
  }
  function notifyCancel(rec, text) {
    notifyCustomer(rec, `שלום 🐾 עדכון מ${KENNEL_NAME}: ${text}. לכל שאלה אנחנו כאן.`);
  }
  // הודעת תודה + דוח קליטה מלא ללקוח (כרטיס אינטראקטיבי בצ'אט; בוואטסאפ — טקסט בלבד)
  function notifyReport(rec, summary, text) {
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const payload = (window.BoarDogReport && window.BoarDogReport.encodeReportMessage)
      ? window.BoarDogReport.encodeReportMessage(text, summary) : text;
    try { S.pushCustomerMsg(payload, id); } catch (e) {}
    const cid = rec && rec.customerId;
    if (cid && window.BoarDogCloud && window.BoarDogCloud.sendCustomerMessage) window.BoarDogCloud.sendCustomerMessage(cid, id, payload);
    if (rec && rec.phone) { // מוצר אמיתי — וואטסאפ (טקסט בלבד)
      const url = notifyUrl();
      if (url) fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: rec.phone, text: text }) }).catch(() => {});
    }
  }

  function refreshDay(date) { renderCalendar(); showDay(date, S.meetingsOn(date), S.boardingsOn(date)); }

  /* ---------- סנכרון ל-Google Calendar ---------- */
  function gcalItems() {
    const today = S.key(new Date());
    const items = [];
    S.meetings().forEach(m => {
      if (!m.date || m.date < today) return; // פגישות עתידיות בלבד ליצירה
      const time = (m.time && /^\d{2}:\d{2}$/.test(m.time)) ? m.time : '16:00';
      const eh = pad(Math.min(23, parseInt(time.slice(0, 2), 10) + 1)) + time.slice(2);
      items.push({
        key: 'm:' + m.id, allDay: false,
        title: `📋 פגישת היכרות — ${m.dogName || ''} (${m.ownerName || ''})`,
        description: 'קליטה ל' + KENNEL_NAME,
        startDateTime: m.date + 'T' + time + ':00', endDateTime: m.date + 'T' + eh + ':00'
      });
    });
    S.boardings().forEach(b => {
      if (!b.end || b.end < today) return; // שהיות שעדיין לא הסתיימו
      items.push({
        key: 'b:' + b.id, allDay: true, start: b.start, end: b.end,
        title: `🏠 שהייה — ${b.dogName || ''} (${b.ownerName || ''})`,
        description: 'שהייה ב' + KENNEL_NAME
      });
    });
    return items;
  }
  function gcalValidKeys() {
    return S.meetings().map(m => 'm:' + m.id).concat(S.boardings().map(b => 'b:' + b.id));
  }
  function refreshGCalUI() {
    const override = window.BoarDogGCal && BoarDogGCal.hasOverride && BoarDogGCal.hasOverride();
    const configured = window.BoarDogGCal && BoarDogGCal.configured();
    const row = $('#bd-gcal-row'), conn = $('#bd-gcal-connected');
    if (row) row.hidden = !!configured;   // מוסתר כשיש Client ID (כולל המוטמע)
    if (conn) conn.hidden = !override;     // "מחובר / שנה" רק אם הוזן מזהה ידני
  }
  function initGCal() {
    const input = $('#bd-gcal-client'), btn = $('#bd-gcal-sync'), change = $('#bd-gcal-change');
    if (!input || !btn || !window.BoarDogGCal) return;
    input.value = BoarDogGCal.clientId();
    refreshGCalUI();
    if (change) change.addEventListener('click', () => { const row = $('#bd-gcal-row'), conn = $('#bd-gcal-connected'); if (row) row.hidden = false; if (conn) conn.hidden = true; input.focus(); });
    btn.addEventListener('click', async () => {
      const cid = input.value.trim();
      if (!cid) { toast('הזינו קודם Google Client ID'); return; }
      BoarDogGCal.setClientId(cid); refreshGCalUI();
      const items = gcalItems();
      if (!items.length) { toast('אין פגישות או שהיות עתידיות לסנכרון'); return; }
      const old = btn.textContent; btn.disabled = true; btn.textContent = 'מסנכרן…';
      try {
        const r = await BoarDogGCal.sync(items, gcalValidKeys());
        toast('סונכרנו ' + r.added + ' אירועים ליומן Google ✓');
      } catch (e) {
        try { console.warn('[BoarDog] GCal sync failed:', e && e.message); } catch (_) {}
        toast('הסנכרון נכשל' + (e && e.message ? ' (' + e.message + ')' : ''));
      } finally { btn.disabled = false; btn.textContent = old; }
    });
  }

  // ניקוי מלא של היומן — כל הפגישות, השהיות והדוחות (זמינות ומאפיינים נשמרים)
  function clearCalendar() {
    if (!confirm('לנקות את כל היומן?\nכל הפגישות, השהיות והדוחות יימחקו לצמיתות — בכל המכשירים. הזמינות והמאפיינים יישארו.')) return;
    const done = () => { seen.meet.clear(); seen.board.clear(); $('#day-detail').innerHTML = ''; renderCalendar(); toast('היומן נוקה ✓'); };
    if (window.BoarDogCloud && window.BoarDogCloud.clearAll) window.BoarDogCloud.clearAll().then(done, done);
    else {
      ['boardog.meetings', 'boardog.boardings', 'boardog.summaries'].forEach(k => { try { localStorage.setItem(k, '[]'); } catch (e) {} });
      done();
    }
  }

  // הסרת יום בודד משהייה: קיצור מהקצה, או פיצול אם זה יום באמצע
  function removeBoardingDay(id, dk) {
    const b = S.boardings().find(x => x.id === id);
    if (!b) return;
    const dayMs = 86400000;
    const prev = S.key(new Date(S.parse(dk).getTime() - dayMs));
    const next = S.key(new Date(S.parse(dk).getTime() + dayMs));
    if (dk <= b.start && dk >= b.end) { S.removeBoarding(id); return; } // יום יחיד
    if (dk === b.start) { S.updateBoarding({ id, start: next }); return; }
    if (dk === b.end) { S.updateBoarding({ id, end: prev }); return; }
    // יום באמצע → מקצרים ל[start, prev] ומוסיפים [next, end]
    S.updateBoarding({ id, end: prev });
    S.addBoarding({ dogName: b.dogName, ownerName: b.ownerName, phone: b.phone, meetingId: b.meetingId, start: next, end: b.end });
  }

  // שריון תאריכי השהייה שסוכמו בפגישת ההיכרות → מופיע ביומן + הודעה ללקוח
  function openReserve(btn, meeting, date) {
    if (!meeting) return;
    const holder = btn.parentElement;
    const today = new Date().toISOString().slice(0, 10);
    const vf = meeting.requestedStart ? ` value="${esc(meeting.requestedStart)}"` : '';
    const vt = meeting.requestedEnd ? ` value="${esc(meeting.requestedEnd)}"` : '';
    holder.innerHTML =
      `<div class="reserve-form">` +
      `<input type="date" class="rf-from" min="${today}"${vf}>` +
      `<input type="date" class="rf-to" min="${today}"${vt}>` +
      `<button class="mini-btn go">שמור</button></div>`;
    holder.querySelector('.go').addEventListener('click', () => {
      const f = holder.querySelector('.rf-from').value, t = holder.querySelector('.rf-to').value;
      if (!f || !t) { toast('בחר/י טווח תאריכים'); return; }
      const start = f <= t ? f : t, end = f <= t ? t : f;
      const rec = S.addBoarding({ dogName: meeting.dogName, ownerName: meeting.ownerName, start, end, meetingId: meeting.id, phone: meeting.phone, customerId: meeting.customerId });
      if (rec && rec.id) seen.board.add(rec.id); // מונע התראה כפולה על פעולה שהבעלים עצמו ביצע
      // עדכון הדוח עם תאריכי השהייה המאושרים, ושליחת תודה + דוח מלא ללקוח
      const prev = (meeting.customerId && S.getSummary) ? (S.getSummary(meeting.customerId) || {}) : {};
      const full = Object.assign({}, prev, {
        customerId: meeting.customerId, ownerName: meeting.ownerName || prev.ownerName,
        dogName: meeting.dogName || prev.dogName, boardingStart: start, boardingEnd: end,
        meeting: prev.meeting || (meeting.date ? meeting.date + (meeting.time ? ' ' + meeting.time : '') : '')
      });
      if (S.saveSummary) { try { S.saveSummary(full); } catch (e) {} }
      // מצמיד את הדוח לאירוע השהייה החדש ולפגישה (כדי שכל אירוע יישא את הדוח שלו)
      if (rec && rec.id) { rec.summary = full; S.updateBoarding(rec); }
      if (meeting && meeting.id) { meeting.summary = full; S.updateMeeting(meeting); }
      notifyReport(meeting, full, `תודה ${meeting.ownerName || ''}! 🎉 השהייה של ${meeting.dogName || 'הכלב'} ב${KENNEL_NAME} אושרה ושוריינה: ${start} → ${end}. הנה סיכום הפרטים שקלטנו 🐾`);
      toast('התאריכים שוריינו — נשלח דוח מלא ללקוח ✓');
      renderCalendar();
      showDay(date, S.meetingsOn(date), S.boardingsOn(date));
    });
  }

  /* ---------- מאפייני הפנסיון ---------- */
  function loadProfile() {
    const p = S.profile() || {};
    if ($('#prof-desc')) $('#prof-desc').value = p.description || '';
    if ($('#prof-cap')) $('#prof-cap').value = p.capacity || '';
    if ($('#prof-notify')) $('#prof-notify').value = notifyUrl();
  }
  function saveProfile() {
    const cap = parseInt($('#prof-cap').value, 10);
    const prev = S.profile() || {};
    S.setProfile(Object.assign({}, prev, {
      description: $('#prof-desc').value.trim(),
      capacity: (cap > 0 ? cap : undefined)
    }));
    toast('המאפיינים נשמרו ✓ הבוט ישתמש בהם');
  }
  async function analyzeProfile() {
    const text = $('#prof-desc').value.trim();
    const status = $('#prof-status');
    if (!text) { status.textContent = 'כתבו תיאור קודם'; return; }
    const cfg = aiCfg();
    const prov = cfg.proxyUrl ? { proxyUrl: cfg.proxyUrl } : (cfg.enabled && cfg.key ? { key: cfg.key } : null);
    if (!prov) { status.textContent = 'להפעלת ניתוח AI: פתחו את צ\'אט הלקוח → ⚙️ והפעילו מצב AI.'; return; }
    status.textContent = 'מנתח…';
    const system = 'אתה מחלץ מאפייני פנסיון כלבים מטקסט חופשי בעברית. החזר JSON תקין בלבד, ללא טקסט נוסף, ' +
      'במבנה: {"capacity": <מספר שלם של כלבים במקביל>, "description": "<תקציר נקי וברור של מאפייני הפנסיון לתשובות ללקוחות, כולל המחירים כפי שנכתבו>"}. ' +
      'אל תשמיט מחירים או מדרגות מחיר — שמור אותם בתוך ה-description. אם לא צוינה תפוסה במפורש — שערו ערך סביר לפי סוג הפנסיון.';
    try {
      const res = await callAI(prov, { system, tools: [], messages: [{ role: 'user', content: text }] });
      const out = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const m = out.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (parsed) {
        if (parsed.capacity) $('#prof-cap').value = parseInt(parsed.capacity, 10) || '';
        if (parsed.description) $('#prof-desc').value = parsed.description;
        status.textContent = 'נותח ✓ בדקו ולחצו "שמור מאפיינים"';
      } else { status.textContent = 'לא הצלחתי לנתח — מלאו ידנית'; }
    } catch (e) { status.textContent = 'שגיאת AI — מלאו ידנית'; }
  }

  /* ---------- גרף הכנסות חודשי ---------- */
  const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  // מחיר בסיס ליום מזוהה מתוך התיאור (המספר "ליום"/הראשון בטווח סביר)
  function basePrice() {
    const d = (S.profile() || {}).description || '';
    let m = d.match(/(\d{2,5})\s*(?:₪|ש"?ח|שקל)[^\d]{0,6}ל?יום/);      // "120 ₪ ליום"
    if (!m) m = d.match(/(\d{2,5})\s*(?:₪|ש"?ח|שקל)/);                  // "120 ₪"
    if (!m) { const nums = (d.match(/\d{2,5}/g) || []).map(Number).filter(n => n >= 30 && n <= 5000); if (nums.length) return nums[0]; }
    return m ? parseInt(m[1], 10) : 0;
  }
  function monthlyDogDays() {
    const map = {};
    S.boardings().forEach(b => {
      if (!b.start || !b.end) return;
      for (let d = new Date(S.parse(b.start)); d <= S.parse(b.end); d.setDate(d.getDate() + 1)) {
        const ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
        map[ym] = (map[ym] || 0) + 1;
      }
    });
    return map;
  }
  const fmtNum = n => Math.round(n).toLocaleString('he-IL');
  const monthLabel = ym => { const [y, mo] = ym.split('-'); return MONTHS_HE[+mo - 1] + ' ' + y; };
  function revMonths() {
    const map = monthlyDogDays();
    const nowYm = new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1);
    if (!(nowYm in map)) map[nowYm] = 0;
    return { map: map, months: Object.keys(map).sort().slice(-12) };
  }
  // ציור עמודות: rows = [{label, value, text}]
  function paintBars(rows) {
    const chart = $('#rev-chart');
    if (!rows.length || rows.every(r => !r.value)) { chart.innerHTML = '<div class="dd-empty">אין עדיין שהיות להצגה.</div>'; return; }
    const max = Math.max(1, ...rows.map(r => r.value));
    chart.innerHTML = rows.map(r =>
      `<div class="rev-row"><div class="rev-label">${r.label}</div>` +
      `<div class="rev-track"><div class="rev-fill" style="width:${Math.max(Math.round(r.value / max * 100), 3)}%"></div></div>` +
      `<div class="rev-val">${r.text}</div></div>`).join('');
  }
  // תצוגת ברירת מחדל — הערכה לפי מחיר בסיס מהתיאור
  function renderRevenue() {
    const price = basePrice();
    const { map, months } = revMonths();
    const rows = months.map(ym => price
      ? { label: monthLabel(ym), value: map[ym] * price, text: fmtNum(map[ym] * price) + ' ₪' }
      : { label: monthLabel(ym), value: map[ym], text: map[ym] + ' ימי-כלב' });
    const total = months.reduce((a, ym) => a + map[ym] * price, 0);
    $('#rev-summary').innerHTML =
      (price ? `<div class="rev-total">סה"כ בתקופה: <b>${fmtNum(total)} ₪</b></div><div class="rev-note">הערכה לפי ${fmtNum(price)} ₪ ליום (מתוך התיאור)</div>`
             : `<div class="rev-note">לא זוהה מחיר בתיאור — הגרף מציג ימי-כלב. הוסיפו מחיר בטאב "מאפיינים".</div>`) +
      `<button class="mini-btn" id="rev-ai" style="margin-top:8px">✨ חשב מדויק עם AI</button>`;
    paintBars(rows);
    const btn = $('#rev-ai'); if (btn) btn.addEventListener('click', computeRevenueAI);
  }
  // חישוב מדויק עם Claude — מיישם את מדיניות המחירים מהתיאור (מדרגות/עונות)
  async function computeRevenueAI() {
    const cfg = aiCfg();
    const prov = cfg.proxyUrl ? { proxyUrl: cfg.proxyUrl } : (cfg.enabled && cfg.key ? { key: cfg.key } : null);
    if (!prov) { $('#rev-summary').innerHTML = '<div class="rev-note">להפעלת חישוב AI: פתחו את צ\'אט הלקוח → ⚙️ והפעילו מצב AI.</div>'; return; }
    const desc = (S.profile() || {}).description || '';
    const boardings = S.boardings().filter(b => b.start && b.end).map(b => ({ start: b.start, end: b.end, days: Math.round((S.parse(b.end) - S.parse(b.start)) / 86400000) + 1 }));
    const { months } = revMonths();
    if (!boardings.length) { renderRevenue(); return; }
    $('#rev-chart').innerHTML = '<div class="dd-empty">Claude מחשב…</div>';
    const system = 'אתה מחשב הכנסות לפנסיון כלבים לפי מדיניות מחירים. מדיניות המחירים והמאפיינים: "' + desc + '". ' +
      'תקבל JSON עם months (רשימת "YYYY-MM") ו-boardings (start,end,days). חשב לכל שהייה את מחירה לפי המדיניות (כולל מדרגות/עונות), ' +
      'ופלג את ההכנסה לחודשים לפי מספר הימים בכל חודש. החזר JSON תקין בלבד במבנה {"YYYY-MM": <הכנסה בש"ח>} לכל חודש ברשימה, ללא טקסט נוסף.';
    try {
      const res = await callAI(prov, { system, tools: [], messages: [{ role: 'user', content: JSON.stringify({ months, boardings }) }] });
      const out = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const m = out.match(/\{[\s\S]*\}/); const parsed = m ? JSON.parse(m[0]) : null;
      if (!parsed) throw 0;
      const rows = months.map(ym => ({ label: monthLabel(ym), value: +parsed[ym] || 0, text: fmtNum(+parsed[ym] || 0) + ' ₪' }));
      const total = rows.reduce((a, r) => a + r.value, 0);
      $('#rev-summary').innerHTML =
        `<div class="rev-total">סה"כ בתקופה: <b>${fmtNum(total)} ₪</b></div>` +
        `<div class="rev-note">✨ חושב מדויק ע"י Claude לפי מדיניות המחירים בתיאור</div>` +
        `<button class="mini-btn" id="rev-est" style="margin-top:8px">↺ חזרה להערכה מהירה</button>`;
      paintBars(rows);
      const b = $('#rev-est'); if (b) b.addEventListener('click', renderRevenue);
    } catch (e) { $('#rev-chart').innerHTML = '<div class="dd-empty">שגיאת AI — נסו שוב.</div>'; }
  }

  /* ---------- שאילתת "כמה כלבים" ---------- */
  function askRange() {
    const f = $('#ask-from').value, t = $('#ask-to').value;
    if (!f || !t) { $('#ask-result').innerHTML = '<div class="dd-empty">בחר/י טווח תאריכים</div>'; return; }
    const r = S.dogsInRange(f, t);
    $('#ask-result').innerHTML =
      `<div class="ar-big">${r.total} כלבים בטווח · שיא של ${r.peak} בו-זמנית</div>` +
      (r.dogs.length ? r.dogs.map(d => `<div class="dd-row board">🐶 ${esc(d.dog)} (${esc(d.owner)}) · ${d.start}→${d.end}</div>`).join('')
        : '<div class="dd-empty">אין שהיות בטווח הזה</div>');
  }

  /* ---------- שאילתת AI חופשית ---------- */
  function aiCfg() { try { return JSON.parse(localStorage.getItem('boardog.ai') || '{}'); } catch (e) { return {}; } }

  // מחוון שימוש AI חודשי (רק כשעובדים דרך proxy עם אכיפת מכסה)
  async function renderAiUsage() {
    const box = $('#ai-usage'); if (!box) return;
    const cfg = aiCfg();
    if (!cfg.proxyUrl) { box.hidden = true; return; }
    const kennel = (window.BoarDogCloud && window.BoarDogCloud.kennelId) || 'default';
    try {
      const r = await fetch(cfg.proxyUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'usage', kennel }) });
      const d = await r.json();
      if (!d || !d.enforced || typeof d.limit !== 'number') { box.hidden = true; return; }
      const left = Math.max(0, d.limit - (d.used || 0));
      box.textContent = `🤖 נותרו ${left} מתוך ${d.limit} הודעות AI החודש`;
      box.classList.toggle('low', left <= Math.max(5, Math.round(d.limit * 0.1)));
      box.hidden = false;
    } catch (e) { box.hidden = true; }
  }
  async function askAi() {
    const q = $('#ask-text').value.trim();
    const out = $('#ask-ai-result');
    if (!q) return;
    const cfg = aiCfg();
    const prov = cfg.proxyUrl ? { proxyUrl: cfg.proxyUrl } : (cfg.enabled && cfg.key ? { key: cfg.key } : null);
    if (!prov) { out.innerHTML = '<div class="dd-empty">להפעלת שאלות חופשיות: פתח/י את צ\'אט הלקוח → ⚙️ והפעל/י מצב AI.</div>'; return; }
    out.innerHTML = '<div class="dd-empty">חושב…</div>';
    const today = S.key(new Date());
    const desc = (S.profile() || {}).description || '';
    const priceLine = desc
      ? 'מדיניות המחירים והמאפיינים של הפנסיון (כפי שכתב הבעלים):\n"' + desc + '"\n' +
        'כשנשאלת על הכנסה — חשב לפי מדיניות המחירים הזו. count_dogs מחזיר לכל שהייה את התאריכים ואת מספר הימים, וכן סה"כ ימי-כלב; החל את המחיר (כולל מדרגות/עונות אם צוינו) על כל שהייה וסכם.'
      : 'מאפייני הפנסיון (כולל מחירים) לא הוגדרו — אם נשאלת על הכנסה, בקש מהבעלים למלא אותם בטאב "מאפיינים".';
    const system = 'אתה עוזר לבעל פנסיון כלבים. היום ' + today + '. כשנשאלת כמה כלבים או כמה הכנסה בתקופה, ' +
      'הסק את טווח התאריכים (אם השנה לא צוינה — השנה הנוכחית) וקרא ל-count_dogs עם start_date ו-end_date בפורמט YYYY-MM-DD. ' +
      priceLine + ' לאחר קבלת התוצאה, ענה בעברית במשפט קצר וברור (כולל סכום ההכנסה ב-₪ אם רלוונטי, ופירוט קצר אם יש מדרגות).';
    const tools = [{ name: 'count_dogs', description: 'מחזיר את השהיות בטווח תאריכים (עם ימים לכל שהייה) וסה"כ ימי-כלב, לחישוב תפוסה והכנסה.', input_schema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } }, required: ['start_date', 'end_date'], additionalProperties: false } }];
    const messages = [{ role: 'user', content: q }];
    try {
      for (let i = 0; i < 4; i++) {
        const res = await callAI(prov, { system, tools, messages });
        messages.push({ role: 'assistant', content: res.content });
        const tu = res.content.filter(b => b.type === 'tool_use');
        const txt = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (res.stop_reason === 'tool_use' && tu.length) {
          messages.push({ role: 'user', content: tu.map(t => {
            const r = S.dogsInRange(t.input.start_date, t.input.end_date);
            const dogs = r.dogs.map(d => Object.assign({}, d, { days: Math.round((S.parse(d.end) - S.parse(d.start)) / 86400000) + 1 }));
            return { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify({ total: r.total, peak: r.peak, total_dog_days: r.dogDays, dogs: dogs }) };
          }) });
          continue;
        }
        out.innerHTML = `<div class="ar-big">${esc(txt)}</div>`; return;
      }
    } catch (e) { out.innerHTML = '<div class="dd-empty">שגיאת AI. נסה/י שוב או השתמש/י בבחירת התאריכים למעלה.</div>'; }
  }
  async function callAI(prov, payload) {
    if (prov.proxyUrl) {
      const r = await fetch(prov.proxyUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw 0; return r.json();
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': prov.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-5', max_tokens: 512, system: payload.system, tools: payload.tools, messages: payload.messages })
    });
    if (!r.ok) throw 0; return r.json();
  }

  /* ---------- שונות ---------- */
  let toastT;
  function toast(msg) {
    let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function init() {
    $('#oh-sub').textContent = KENNEL_NAME;
    initTabs();
    renderAvail();
    renderCalendar();
    $('#save-avail').addEventListener('click', saveAvail);
    $('#cal-prev').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderCalendar(); });
    $('#cal-next').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderCalendar(); });
    const clearBtn = $('#clear-cal'); if (clearBtn) clearBtn.addEventListener('click', clearCalendar);
    initGCal();
    const today = new Date().toISOString().slice(0, 10);
    $('#ask-from').value = today; $('#ask-to').value = today;
    $('#ask-go').addEventListener('click', askRange);
    $('#ask-ai-go').addEventListener('click', askAi);
    loadProfile();
    $('#prof-save').addEventListener('click', saveProfile);
    $('#prof-ai').addEventListener('click', analyzeProfile);
    $('#prof-notify-save').addEventListener('click', () => {
      try { localStorage.setItem(NOTIFY_KEY, $('#prof-notify').value.trim()); } catch (e) {}
      toast('כתובת ההתראות נשמרה ✓');
    });
    scanNew(true); // זריעה ראשונית ללא התראה
    // רענון חי + התראה כשמגיעה הזמנה חדשה מהשרת (זמן אמת)
    document.addEventListener('boardog:sync', () => {
      renderCalendar(); scanNew(false);
      const rev = document.querySelector('.opanel[data-panel="revenue"]');
      if (rev && !rev.hidden) renderRevenue();
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
