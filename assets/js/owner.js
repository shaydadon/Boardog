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
  let viewDate = new Date();
  const seen = { meet: new Set(), board: new Set() };

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
        return `<div class="dd-row meet">📋 פגישת היכרות ${m.time} — ${esc(m.dogName)} (${esc(m.ownerName)}) ` +
          `<button class="del-btn" title="מחק פגישה" data-del-meet="${esc(m.id)}">🗑</button>` +
          (done ? `<span class="dd-tag ok">✓ תאריכים שוריינו</span>`
                : `<span class="dd-tag wait">⏳ ממתין לתאריכים</span>` + req +
                  `<div class="dd-reserve"><button class="mini-btn" data-mid="${esc(m.id)}">＋ שריין תאריכי שהייה</button></div>`) +
          `</div>`;
      }).join('') +
      boards.map(b => {
        const multi = b.start !== b.end;
        return `<div class="dd-row board">🏠 שהייה — ${esc(b.dogName)} (${esc(b.ownerName)}) · ${b.start}→${b.end}` +
          `<div class="dd-del">` +
          (multi ? `<button class="del-btn" data-del-day="${esc(b.id)}">🗑 יום זה (${S.key(date)})</button>` : '') +
          `<button class="del-btn" data-del-board="${esc(b.id)}">🗑 כל השהייה</button>` +
          `</div></div>`;
      }).join('');
    box.querySelectorAll('.mini-btn[data-mid]').forEach(btn =>
      btn.addEventListener('click', () => openReserve(btn, meets.find(m => m.id === btn.dataset.mid), date)));
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

  // הודעת ביטול ללקוח. אם הוגדרה כתובת Worker → שולח וואטסאפ אמיתי; אחרת מדמה.
  const NOTIFY_KEY = 'boardog.notifyUrl';
  const notifyUrl = () => { try { return localStorage.getItem(NOTIFY_KEY) || ''; } catch (e) { return ''; } };
  function notifyCancel(rec, text) {
    if (!rec || !rec.phone) return;
    const url = notifyUrl();
    const body = `שלום 🐾 עדכון מ${KENNEL_NAME}: ${text}. לכל שאלה אנחנו כאן.`;
    if (url) {
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: rec.phone, text: body }) }).catch(() => {});
    } else {
      try { console.log('[BoarDog] (דמו) הודעת ביטול ללקוח', rec.phone, '—', body); } catch (e) {}
    }
  }

  function refreshDay(date) { renderCalendar(); showDay(date, S.meetingsOn(date), S.boardingsOn(date)); }

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
      const rec = S.addBoarding({ dogName: meeting.dogName, ownerName: meeting.ownerName, start, end, meetingId: meeting.id, phone: meeting.phone });
      if (rec && rec.id) seen.board.add(rec.id); // מונע התראה כפולה על פעולה שהבעלים עצמו ביצע
      toast('התאריכים שוריינו — נשלחה הודעה ללקוח ✓');
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
    S.setProfile({ description: $('#prof-desc').value.trim(), capacity: (cap > 0 ? cap : undefined) });
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
      'במבנה: {"capacity": <מספר שלם של כלבים במקביל>, "description": "<תקציר נקי וברור של מאפייני הפנסיון לתשובות ללקוחות>"}. ' +
      'אם לא צוינה תפוסה במפורש — שערו ערך סביר לפי סוג הפנסיון.';
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
  async function askAi() {
    const q = $('#ask-text').value.trim();
    const out = $('#ask-ai-result');
    if (!q) return;
    const cfg = aiCfg();
    const prov = cfg.proxyUrl ? { proxyUrl: cfg.proxyUrl } : (cfg.enabled && cfg.key ? { key: cfg.key } : null);
    if (!prov) { out.innerHTML = '<div class="dd-empty">להפעלת שאלות חופשיות: פתח/י את צ\'אט הלקוח → ⚙️ והפעל/י מצב AI.</div>'; return; }
    out.innerHTML = '<div class="dd-empty">חושב…</div>';
    const today = S.key(new Date());
    const system = 'אתה עוזר לבעל פנסיון כלבים. היום ' + today + '. כשנשאלת כמה כלבים יהיו בפנסיון בתקופה, ' +
      'הסק את טווח התאריכים (אם השנה לא צוינה — השנה הנוכחית) וקרא ל-count_dogs עם start_date ו-end_date בפורמט YYYY-MM-DD. ' +
      'לאחר קבלת התוצאה, ענה בעברית במשפט קצר וברור.';
    const tools = [{ name: 'count_dogs', description: 'מחזיר כמה כלבים יהיו בפנסיון בטווח תאריכים.', input_schema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } }, required: ['start_date', 'end_date'], additionalProperties: false } }];
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
            return { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify({ total: r.total, peak: r.peak, dogs: r.dogs }) };
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
    document.addEventListener('boardog:sync', () => { renderCalendar(); scanNew(false); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
