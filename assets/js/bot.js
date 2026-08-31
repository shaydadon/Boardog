/* =============================================================
   BoarDog – מנוע השיחה
   שני מנועים מאחורי ממשק אחיד:
   • ScriptedBot – זרימת תשאול מונחית (עובד תמיד, בלי מפתח/רשת)
   • AiBot       – Claude אמיתי עם Tool Use (דרך פרוקסי או מפתח BYOK)
   שניהם פולטים אירועים דרך callbacks: onBot / onTyping / onDone.
   ============================================================= */
(function (global) {
  'use strict';

  const K = global.BoarDogKennel.KENNEL;
  const INTAKE = global.BoarDogKennel.INTAKE;
  const fill = (s, a) => s.replace(/\{(\w+)\}/g, (_, k) => a[k] || '');

  /* ---------------- מנוע מונחה (ברירת מחדל) ---------------- */
  function ScriptedBot(io) {
    let step = -1;
    const answers = {};

    function ask() {
      step++;
      if (step < INTAKE.length) {
        const s = INTAKE[step];
        io.bot({ text: fill(s.q, answers), choices: s.choices || null });
      } else {
        offerSlots();
      }
    }

    function offerSlots() {
      const slots = K.availableSlots().slice(0, 5);
      io.bot({
        text: `תודה ${answers.ownerName || ''}! 🙌 לפני קליטה אנחנו קובעים פגישת היכרות קצרה עם ${answers.dogName || 'הכלב'}.\nהנה המועדים הפנויים אצלנו — מה מתאים לך?`,
        slots: slots.map(s => ({ id: s.id, label: s.label }))
      });
    }

    function pickSlot(id) {
      const ok = K.book(id);
      const slot = K.findSlot(id);
      if (!ok) { io.bot({ text: 'אופס, המועד הזה כבר נתפס 😅 בוא/י נבחר אחר:', slots: K.availableSlots().slice(0, 5).map(s => ({ id: s.id, label: s.label })) }); return; }
      answers.meeting = slot.label;
      io.bot({ text: `מעולה! ✅ שיריינתי לך פגישת היכרות ל${slot.label}. נתראה! 🐶\nשלחתי את כל הפרטים ל${K.ownerName} מהפנסיון — הוא יאשר סופית ויחזור אליך אם צריך.` });
      io.done(summary());
    }

    function summary() {
      return { kennel: K.name, answers: Object.assign({}, answers) };
    }

    // מענה לשאלה פתוחה תוך כדי הזרימה, ואז חזרה לשאלה הנוכחית
    function tryAnswerQuestion(text) {
      if (!K.isQuestion(text)) return false;
      const a = K.faqAnswer(text);
      io.bot({ text: a || `שאלה טובה! 🙂 אני אעביר את זה ל${K.ownerName} והוא יחזור אליך. בינתיים נמשיך —` });
      const s = INTAKE[step];
      if (s) setTimeout(() => io.bot({ text: fill(s.q, answers), choices: s.choices || null }), 400);
      return true;
    }

    return {
      start() { io.bot({ text: `שלום! 👋 הגעתם ל*${K.name}*. אני העוזר/ת החכם/ה של ${K.ownerName}. אפשר לשאול אותי כל שאלה, ואשמח גם לעזור לקלוט את הכלב שלכם לפנסיון.` }); setTimeout(ask, 600); },
      input(text) {
        if (tryAnswerQuestion(text)) return;      // שאלה פתוחה → מענה + חזרה לשאלה
        const s = INTAKE[step];
        if (s) answers[s.key] = text;
        setTimeout(ask, 300);
      },
      pickSlot,
      mode: 'scripted'
    };
  }

  /* ---------------- מנוע AI (Claude + Tool Use) ---------------- */
  const SYSTEM =
    'את/ה עוזר/ת וירטואלי/ת של פנסיון כלבים בשם "' + K.name + '" (מנהל: ' + K.ownerName + '). ' +
    'המטרה: לקלוט לקוח חדש בצ\'אט וואטסאפ בעברית, בחום ובקצרה (הודעות קצרות, שאלה אחת-שתיים בכל פעם, אפשר אימוג\'ים). ' +
    'הלקוח יכול לשאול שאלות פתוחות בכל שלב (מחיר, שעות, מה להביא, מדיניות וכו\') — ענה/י מיד ובאדיבות לפי "מידע על הפנסיון" למטה, ' +
    'ואז המשך/י בעדינות באיסוף הפרטים. אל תמציא/י עובדות שאינן במידע; אם נשאלת משהו שאינו שם, אמור/י שתעביר/י ל' + K.ownerName + ' שיחזור אליהם. ' +
    'הפרטים לאסוף: שם הבעלים, שם הכלב, גזע, גיל, גודל, האם מעוקר/מסורס, חיסונים בתוקף, טיפול נגד פרעושים/קרציות, ' +
    'בעיות בריאות/תרופות, התאמה לכלבים אחרים, עבר תוקפנות/נשיכות, אוכל ולו"ז, ותאריכי השהייה. ' +
    'לאחר איסוף הפרטים קרא/י ל-get_available_slots והצג/י 3–5 מועדים לפגישת היכרות. כשהלקוח בוחר — book_meeting. ' +
    'לבסוף save_summary עם כל הנתונים והמועד, והודה/י ללקוח.\n\n' +
    'מידע על הפנסיון:\n' + K.knowledge();

  const TOOLS = [
    { name: 'get_available_slots', description: 'מחזיר את מועדי פגישות ההיכרות הפנויים בפנסיון.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'book_meeting', description: 'משריין מועד פגישת היכרות.', input_schema: { type: 'object', properties: { slot_id: { type: 'string' } }, required: ['slot_id'], additionalProperties: false } },
    { name: 'save_summary', description: 'שומר את סיכום הקליטה עבור בעל הפנסיון.', input_schema: {
        type: 'object', properties: {
          ownerName: { type: 'string' }, dogName: { type: 'string' }, breed: { type: 'string' },
          age: { type: 'string' }, size: { type: 'string' }, neutered: { type: 'string' },
          vaccinated: { type: 'string' }, fleaTick: { type: 'string' }, health: { type: 'string' },
          withDogs: { type: 'string' }, aggression: { type: 'string' }, food: { type: 'string' },
          dates: { type: 'string' }, meeting: { type: 'string' }
        }, additionalProperties: true
      } }
  ];

  function runTool(name, input) {
    if (name === 'get_available_slots') {
      return { slots: K.availableSlots().slice(0, 6).map(s => ({ id: s.id, label: s.label })) };
    }
    if (name === 'book_meeting') {
      const ok = K.book(input.slot_id);
      const slot = K.findSlot(input.slot_id);
      return ok ? { ok: true, booked: slot ? slot.label : input.slot_id }
        : { ok: false, reason: 'המועד תפוס — הצע מועד אחר מ-get_available_slots' };
    }
    if (name === 'save_summary') { return { ok: true }; }
    return { error: 'unknown tool' };
  }

  function AiBot(io, cfg) {
    const messages = [];
    let lastSummary = null;

    async function call() {
      const payload = { system: SYSTEM, tools: TOOLS, messages };
      const data = cfg.proxyUrl
        ? await callProxy(cfg.proxyUrl, payload)
        : await callClaude(cfg.key, payload);
      return data; // {content:[...], stop_reason}
    }

    async function loop() {
      io.typing(true);
      let guard = 0;
      while (guard++ < 8) {
        let res;
        try { res = await call(); }
        catch (e) { io.typing(false); io.bot({ text: '⚠️ שגיאת AI. עוברים למצב מונחה.' }); io.fallback(); return; }
        messages.push({ role: 'assistant', content: res.content });

        const toolUses = res.content.filter(b => b.type === 'tool_use');
        // הצג טקסט שהמודל כתב
        const texts = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (texts) io.bot({ text: texts });

        if (res.stop_reason === 'tool_use' && toolUses.length) {
          const results = toolUses.map(tu => {
            const out = runTool(tu.name, tu.input || {});
            if (tu.name === 'save_summary') lastSummary = tu.input || {};
            // אם המודל שיריין מועד — נציג סיכום לבעל הפנסיון
            return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) };
          });
          messages.push({ role: 'user', content: results });
          continue; // המשך הלולאה עד תשובה סופית
        }
        break;
      }
      io.typing(false);
      if (lastSummary) io.done({ kennel: K.name, answers: lastSummary });
    }

    return {
      start() { messages.push({ role: 'user', content: 'שלום' }); loop(); },
      input(text) { messages.push({ role: 'user', content: text }); loop(); },
      pickSlot(id) { const s = K.findSlot(id); messages.push({ role: 'user', content: 'אני בוחר/ת: ' + (s ? s.label : id) }); loop(); },
      mode: 'ai'
    };
  }

  /* ---------------- קריאות AI ---------------- */
  async function callProxy(url, payload) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('proxy ' + res.status);
    return res.json();
  }
  async function callClaude(key, payload) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': key,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-5', max_tokens: 1024,
        system: payload.system, tools: payload.tools, messages: payload.messages
      })
    });
    if (!res.ok) throw new Error('claude ' + res.status);
    return res.json();
  }

  global.BoarDogBot = { ScriptedBot, AiBot };
})(window);
