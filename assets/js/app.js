/* =============================================================
   BoarDog – לוגיקת הצ'אט (ממשק בסגנון וואטסאפ)
   ============================================================= */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const K = window.BoarDogKennel.KENNEL;

  const chat = $('#chat');
  const quick = $('#quick');
  const input = $('#chat-input');
  const AI_STORE = 'boardog.ai';
  const load = () => { try { return JSON.parse(localStorage.getItem(AI_STORE) || '{}'); } catch (e) { return {}; } };
  const save = v => { try { localStorage.setItem(AI_STORE, JSON.stringify(v)); } catch (e) {} };

  let bot = null;
  let typingEl = null;

  // שמירת סשן השיחה כדי לזכור אותה בין ביקורים
  const SESS = 'boardog.session';
  let transcript = [];   // [{who, text}]
  let pending = null;    // הכפתורים/קלט שהיו על המסך אחרונים
  let doneFlag = false;
  let restoring = false;
  let lastInboxTs = 0;   // חותמת ההודעה האחרונה מהבעלים שכבר הוצגה
  function persist() {
    try {
      localStorage.setItem(SESS, JSON.stringify({
        mode: bot ? bot.mode : null, transcript, pending, done: doneFlag, lastInboxTs,
        bot: (bot && bot.getState) ? bot.getState() : null
      }));
    } catch (e) {}
  }
  // הודעות שהבעלים שלח (שריון/ביטול) → מופיעות בצ'אט הלקוח
  function drainInbox() {
    const S = window.BoarDogStore;
    if (!S || !S.inboxSince) return;
    const msgs = S.inboxSince(lastInboxTs);
    if (!msgs.length) return;
    msgs.forEach(m => addMsg(m.text, 'bot'));
    lastInboxTs = msgs[msgs.length - 1].ts;
    persist();
    scroll();
  }
  function clearSession() { try { localStorage.removeItem(SESS); } catch (e) {} }

  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fmt = s => esc(s).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const now = () => { const d = new Date(); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); };

  function addMsg(text, who) {
    clearQuick();
    const row = document.createElement('div');
    row.className = 'msg ' + who;
    row.innerHTML = `<div class="bubble">${fmt(text)}<span class="time">${now()}</span></div>`;
    chat.appendChild(row);
    scroll();
    if (!restoring) transcript.push({ who, text });
    return row;
  }

  function showTyping(on) {
    if (on) {
      if (typingEl) return;
      typingEl = document.createElement('div');
      typingEl.className = 'msg bot';
      typingEl.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
      chat.appendChild(typingEl); scroll();
    } else if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function clearQuick() { quick.innerHTML = ''; }
  function renderChoices(choices) {
    clearQuick();
    choices.forEach(c => {
      const b = document.createElement('button');
      b.className = 'quick-btn'; b.textContent = c;
      b.addEventListener('click', () => sendUser(c));
      quick.appendChild(b);
    });
  }
  function renderSlots(slots) {
    clearQuick();
    slots.forEach(s => {
      const b = document.createElement('button');
      b.className = 'quick-btn slot'; b.textContent = '📅 ' + s.label;
      b.addEventListener('click', () => { addMsg(s.label, 'user'); persist(); if (bot) bot.pickSlot(s.id); });
      quick.appendChild(b);
    });
  }

  function renderDateRange() {
    clearQuick();
    const today = new Date().toISOString().slice(0, 10);
    const wrap = document.createElement('div');
    wrap.className = 'daterange';
    wrap.innerHTML =
      `<label>מ־ <input type="date" id="dr-from" min="${today}"></label>` +
      `<label>עד <input type="date" id="dr-to" min="${today}"></label>` +
      `<button class="quick-btn" id="dr-go">שריין שהייה</button>`;
    quick.appendChild(wrap);
    document.getElementById('dr-go').addEventListener('click', () => {
      const f = document.getElementById('dr-from').value, t = document.getElementById('dr-to').value;
      if (!f || !t) return;
      const from = f <= t ? f : t, to = f <= t ? t : f;
      addMsg(`שהייה: ${from} עד ${to}`, 'user');
      clearQuick();
      persist();
      if (bot) bot.boarding(from, to);
    });
  }

  function scroll() { chat.scrollTop = chat.scrollHeight; }

  // ה-IO שמחבר בין המנוע ל-UI
  const io = {
    bot(m) {
      showTyping(false);
      // דימוי "הקלדה" קצר לתחושת וואטסאפ
      showTyping(true);
      setTimeout(() => {
        showTyping(false);
        addMsg(m.text, 'bot');
        pending = null;
        if (m.choices) { renderChoices(m.choices); pending = { choices: m.choices }; }
        if (m.slots) { renderSlots(m.slots); pending = { slots: m.slots }; }
        if (m.daterange) { renderDateRange(); pending = { daterange: true }; }
        persist();
      }, Math.min(700, 250 + m.text.length * 6));
    },
    typing(on) { showTyping(on); },
    done(summary) { doneFlag = true; pending = null; persist(); setTimeout(() => renderSummary(summary), 900); },
    fallback() { startScripted(); }
  };

  function sendUser(text) {
    text = (text || '').trim();
    if (!text) return;
    addMsg(text, 'user');
    input.value = '';
    persist();
    if (bot) bot.input(text);
  }

  function renderSummary(summary) {
    const a = summary.answers || {};
    const rows = [
      ['בעלים', a.ownerName], ['כלב', a.dogName], ['גזע', a.breed], ['גיל', a.age],
      ['גודל', a.size], ['מעוקר/מסורס', a.neutered], ['חיסונים', a.vaccinated],
      ['פרעושים/קרציות', a.fleaTick], ['בריאות', a.health], ['עם כלבים', a.withDogs],
      ['תוקפנות בעבר', a.aggression], ['אוכל', a.food],
      ['תאריכי שהייה', a.boardingStart ? (a.boardingStart + ' – ' + a.boardingEnd) : null],
      ['תאריכים מבוקשים (לאישור בפגישה)', a.requestedStart ? (a.requestedStart + ' – ' + a.requestedEnd) : null],
      ['פגישת היכרות', a.meeting]
    ].filter(r => r[1]);
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.innerHTML =
      `<div class="sc-head">📋 סיכום קליטה ל${esc(K.ownerName)} — ${esc(K.name)}</div>` +
      rows.map(r => `<div class="sc-row"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('') +
      `<div class="sc-note">✅ זה מה שבעל הפנסיון מקבל אוטומטית — בלי שיחת טלפון אחת.</div>`;
    chat.appendChild(card); scroll();
    clearQuick();
    const again = document.createElement('button');
    again.className = 'quick-btn'; again.textContent = '🔄 התחל שיחה חדשה';
    again.addEventListener('click', restart);
    quick.appendChild(again);
  }

  /* ---------- הפעלה ---------- */
  function aiProvider() {
    const c = load();
    if (c.proxyUrl) return { proxyUrl: c.proxyUrl };
    if (c.enabled && c.key) return { key: c.key };
    return null;
  }
  function startScripted() { bot = window.BoarDogBot.ScriptedBot(io); bot.start(); }
  function startAi(cfg) { io.cfg = cfg; bot = window.BoarDogBot.AiBot(io); bot.start(); }

  function restart() {
    clearSession();
    chat.innerHTML = ''; clearQuick();
    transcript = []; pending = null; doneFlag = false;
    lastInboxTs = Date.now(); // התעלמות מהודעות בעלים ישנות בשיחה חדשה
    const cfg = aiProvider();
    setBadge(!!cfg);
    if (cfg) startAi(cfg); else startScripted();
  }

  function addRestartButton() {
    const again = document.createElement('button');
    again.className = 'quick-btn'; again.textContent = '🔄 התחל שיחה חדשה';
    again.addEventListener('click', restart);
    quick.appendChild(again);
  }

  // שחזור סשן קודם (רציפות השיחה בין ביקורים)
  function resume(session) {
    transcript = Array.isArray(session.transcript) ? session.transcript : [];
    doneFlag = !!session.done;
    lastInboxTs = session.lastInboxTs || 0;
    const cfg = aiProvider();
    setBadge(!!cfg);
    // מרנדרים מחדש את ההודעות הקודמות
    restoring = true;
    transcript.forEach(m => addMsg(m.text, m.who));
    restoring = false;
    // מקימים את הבוט עם המצב השמור (בלי לפתוח שיחה חדשה)
    if (cfg) { io.cfg = cfg; bot = window.BoarDogBot.AiBot(io, session.bot); }
    else bot = window.BoarDogBot.ScriptedBot(io, session.bot);
    // משחזרים את הכפתורים/קלט שהיו על המסך
    const p = session.pending;
    if (p && p.choices) renderChoices(p.choices);
    else if (p && p.slots) renderSlots(p.slots);
    else if (p && p.daterange) renderDateRange();
    if (doneFlag) addRestartButton();
    drainInbox(); // הודעות בעלים שהגיעו בזמן שהצ'אט היה סגור
  }

  function setBadge(ai) {
    const badge = $('#mode-badge');
    badge.textContent = ai ? '✨ AI (Claude)' : 'מצב הדגמה';
    badge.className = 'mode-badge ' + (ai ? 'ai' : '');
  }

  function init() {
    // הגדרות AI
    const cfg = load();
    $('#ai-proxy').value = cfg.proxyUrl || '';
    $('#ai-key').value = cfg.key || '';
    $('#ai-enabled').checked = !!cfg.enabled;
    $('#save-ai').addEventListener('click', () => {
      save({ proxyUrl: $('#ai-proxy').value.trim(), key: $('#ai-key').value.trim(), enabled: $('#ai-enabled').checked });
      $('#settings').hidden = true;
      restart();
    });
    $('#open-settings').addEventListener('click', () => { $('#settings').hidden = false; });
    $('#close-settings').addEventListener('click', () => { $('#settings').hidden = true; });

    $('#send').addEventListener('click', () => sendUser(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendUser(input.value); });

    // עדכון חי: אותו דפדפן (storage), בין מכשירים (boardog:inbox מ-cloud), וסנכרון כללי
    window.addEventListener('storage', (e) => { if (e.key === 'boardog.inbox') drainInbox(); });
    document.addEventListener('boardog:inbox', () => drainInbox());
    document.addEventListener('boardog:sync', () => drainInbox());

    // אם יש סשן שמור עם היסטוריה — ממשיכים אותו; אחרת מתחילים חדש
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESS) || 'null'); } catch (e) { saved = null; }
    if (saved && Array.isArray(saved.transcript) && saved.transcript.length) resume(saved);
    else restart();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
