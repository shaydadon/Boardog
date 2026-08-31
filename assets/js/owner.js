/* =============================================================
   BoarDog – אפליקציית בעל הפנסיון
   זמינות שבועית · יומן פגישות ושהיות · שאילתת AI "כמה כלבים בתקופה"
   ============================================================= */
(function () {
  'use strict';
  const S = window.BoarDogStore;
  const $ = s => document.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const KENNEL_NAME = 'פנסיון הכלב המאושר · רועי';
  const HOURS = [8, 10, 12, 14, 16, 18, 20];
  const DOW = S.DOW;
  let viewDate = new Date();

  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /* ---------- טאבים ---------- */
  function initTabs() {
    document.querySelectorAll('.otab').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.otab').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.opanel').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.otab; });
      if (b.dataset.otab === 'cal') renderCalendar();
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
      meets.map(m => `<div class="dd-row meet">📋 פגישת היכרות ${m.time} — ${esc(m.dogName)} (${esc(m.ownerName)})</div>`).join('') +
      boards.map(b => `<div class="dd-row board">🏠 שהייה — ${esc(b.dogName)} (${esc(b.ownerName)}) · ${b.start}→${b.end}</div>`).join('');
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
  }
  document.addEventListener('DOMContentLoaded', init);
})();
