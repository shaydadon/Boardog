/* =============================================================
   BoarDog – מנוע השיחה (צד הלקוח)
   • ScriptedBot – זרימת תשאול מונחית (עובד תמיד)
   • AiBot       – Claude אמיתי עם Tool Use (פרוקסי/BYOK)
   שניהם כותבים פגישות ושהיות ל-BoarDogStore (משותף עם צד הפנסיון).
   ============================================================= */
(function (global) {
  'use strict';

  const K = global.BoarDogKennel.KENNEL;
  const INTAKE = global.BoarDogKennel.INTAKE;
  const S = global.BoarDogStore;
  const fill = (s, a) => s.replace(/\{(\w+)\}/g, (_, k) => a[k] || '');

  /* ---------------- מנוע מונחה ---------------- */
  function ScriptedBot(io, saved) {
    saved = saved || {};
    let step = (typeof saved.step === 'number') ? saved.step : -1;
    let returning = !!saved.returning, askedDates = !!saved.askedDates;
    const answers = saved.answers || {};
    let lastMeeting = saved.lastMeetingId ? (S.meetings().find(m => m.id === saved.lastMeetingId) || null) : null;
    function getState() { return { step, returning, askedDates, answers, lastMeetingId: lastMeeting && lastMeeting.id }; }

    // בדיקת יומן: האם התאריכים פנויים וכמה כלבים כבר בטווח
    function capacityCheck(start, end) {
      const r = S.dogsInRange(start, end);
      const cap = S.capacity();
      if (r.peak >= cap) {
        return `בדקתי ביומן 🗓️ — בתאריכים ${start}–${end} הפנסיון כמעט מלא (${r.peak} כלבים בו-זמנית). ${K.ownerName} יבדוק אפשרויות בפגישה.`;
      }
      return `בדקתי ביומן 🗓️ — התאריכים ${start}–${end} פנויים 🎉 ` +
        (r.peak ? `(רשומים כרגע ${r.peak} כלבים אחרים בטווח, יש מקום).` : '(אין כלבים אחרים בטווח כרגע).');
    }

    function ask() {
      step++;
      if (returning) {
        if (!askedDates) {
          askedDates = true;
          io.bot({ text: `ברוך שובך, ${answers.ownerName}! 🎾 שמחים לראותך שוב.\nלאילו תאריכים לשריין את השהייה של ${answers.dogName || 'הכלב'} הפעם?`, daterange: true });
        }
        return;
      }
      if (step < INTAKE.length) {
        const s = INTAKE[step];
        let q = fill(s.q, answers);
        // שאלת עיקור/סירוס מותאמת למין הכלב
        if (s.key === 'neutered') {
          const fem = /נקבה/.test(answers.sex || '');
          q = fem ? `האם ${answers.dogName || 'הכלבה'} מעוקרת?` : `האם ${answers.dogName || 'הכלב'} מסורס?`;
        }
        io.bot({ text: q, choices: s.choices || null });
      } else offerSlots();
    }

    function offerSlots() {
      // רענון מהשרת לפני הצגת החלונות כדי שיהיו עדכניים תמיד
      const show = () => {
        const slots = S.deriveSlots().slice(0, 5);
        if (!slots.length) { io.bot({ text: 'כרגע אין מועדים פנויים לפגישת היכרות 😕 נעביר את זה ל' + K.ownerName + ' שיחזור אליך.' }); io.done(summary()); return; }
        io.bot({
          text: `תודה ${answers.ownerName || ''}! 🙌 לפני קליטה נקבע פגישת היכרות קצרה עם ${answers.dogName || 'הכלב'}.\nהנה המועדים הפנויים — מה מתאים לך?`,
          slots: slots.map(s => ({ id: s.id, label: s.label }))
        });
      };
      if (window.BoarDogCloud && window.BoarDogCloud.refresh) window.BoarDogCloud.refresh().then(show, show);
      else show();
    }

    function pickSlot(id) {
      const slot = S.findSlot(id);
      if (!slot) { io.bot({ text: 'אופס, המועד נתפס 😅 בוא/י נבחר אחר:', slots: S.deriveSlots().slice(0, 5).map(s => ({ id: s.id, label: s.label })) }); return; }
      lastMeeting = S.addMeeting({ date: slot.date, time: slot.time, dogName: answers.dogName, ownerName: answers.ownerName, breed: answers.breed, customerId: S.customerId() });
      answers.meeting = slot.label;
      // לקוח חדש: קובעים פגישת היכרות, ושואלים אילו תאריכי שהייה לבדוק ביומן
      io.bot({ text: `מעולה! ✅ קבעתי פגישת היכרות ל${slot.label}.\nכדי שנוכל להיערך — לאילו תאריכים תרצה/י לשריין את השהייה של ${answers.dogName || 'הכלב'}?`, daterange: true });
    }

    function boarding(start, end) {
      if (returning) {
        // לקוח חוזר — שריון תאריכים ישיר בצ'אט
        S.addBoarding({ dogName: answers.dogName || '', ownerName: answers.ownerName, start, end, customerId: S.customerId() });
        answers.boardingStart = start; answers.boardingEnd = end;
        io.bot({ text: `סגור! 🐶 שיריינתי שהייה מ-${start} עד ${end}.\nשלחתי אישור ל${K.ownerName} מהפנסיון — נתראה! 🎾` });
        io.done(summary());
        return;
      }
      // לקוח חדש — בדיקת יומן בלבד; השריון בפועל אחרי פגישת ההיכרות
      answers.requestedStart = start; answers.requestedEnd = end;
      if (lastMeeting) { lastMeeting.requestedStart = start; lastMeeting.requestedEnd = end; S.updateMeeting(lastMeeting); }
      io.bot({ text: capacityCheck(start, end) });
      io.bot({ text: `📌 שיריון תאריכי השהייה יבוצע לאחר פגישת ההיכרות, אחרי שנכיר את ${answers.dogName || 'הכלב'} ונראה שהכל מסתדר יפה.` });
      io.done(summary());
    }

    function summary() {
      const ans = Object.assign({ customerId: S.customerId() }, answers);
      try { if (S.saveSummary) S.saveSummary(ans); } catch (e) {} // שמירה מתמשכת + סנכרון
      return { kennel: K.name, answers: ans };
    }

    function tryAnswerQuestion(text) {
      if (!K.isQuestion(text)) return false;
      const a = K.faqAnswer(text);
      io.bot({ text: a || `שאלה טובה! 🙂 אעביר ל${K.ownerName} והוא יחזור אליך. בינתיים נמשיך —` });
      const s = INTAKE[step];
      if (s) setTimeout(() => io.bot({ text: fill(s.q, answers), choices: s.choices || null }), 400);
      return true;
    }

    return {
      start() { io.bot({ text: `שלום! 👋 הגעתם ל*${K.name}*. אני העוזר/ת החכם/ה של ${K.ownerName}. אפשר לשאול אותי כל שאלה, ואשמח גם לעזור לקלוט את הכלב שלכם לפנסיון.` }); setTimeout(ask, 600); },
      input(text) {
        if (tryAnswerQuestion(text)) return;
        const s = INTAKE[step];
        if (s) answers[s.key] = text;
        // זיהוי לקוח חוזר מיד לאחר קליטת השם → דילוג על התשאול
        if (s && s.key === 'ownerName' && S.isReturning(answers.ownerName)) {
          returning = true;
          answers.dogName = S.lastDogFor(answers.ownerName) || answers.dogName || '';
        }
        setTimeout(ask, 300);
      },
      pickSlot, boarding, getState,
      mode: 'scripted'
    };
  }

  /* ---------------- מנוע AI (Claude + Tool Use) ---------------- */
  const SYSTEM =
    'את/ה עוזר/ת וירטואלי/ת של פנסיון כלבים בשם "' + K.name + '" (מנהל: ' + K.ownerName + '). ' +
    'קלוט/י פניות בוואטסאפ בעברית, בחום ובקצרה. ' +
    'חוקי סגנון מחייבים: (1) שאלה אחת בלבד בכל הודעה — לעולם לא שתיים. ' +
    '(2) אסור רשימות ממוספרות של שאלות ואסור כוכביות/הדגשות — כתוב/כתבי כמו אדם בוואטסאפ, משפט או שניים קצרים. ' +
    '(3) קודם התייחס/י בקצרה למה שהלקוח כתב עכשיו, ואז שאלה אחת להמשך. ' +
    '(4) בלי הרצאות ובלי הומור מוגזם — טבעי, אנושי וקצר. ' +
    'אל תחזור/י על שאלה שכבר נענתה; הסק/י פרטים מהקונטקסט (למשל אם הלקוח כתב "מלטז בן 3" — כבר יש לך גזע וגיל). ' +
    'אם הלקוח מציין שהשיחה נקטעה/קרסה, או שכבר דיברתם — התנצל/י בחום, הודה/י לו, והמשך/י בעדינות מאיפה שאפשר בלי להתחיל מחדש.\n' +
    'תחילה שאל/י לשם הפונה, וקרא/י ל-lookup_customer עם owner_name כדי לבדוק אם זה לקוח קיים.\n' +
    '• אם returning=true (לקוח קיים): דלג/י על התשאול לגמרי, ברך/י אותו בשמו, ובקש/י ישירות את תאריכי השהייה. ' +
    'קרא/י ל-book_boarding (start_date, end_date, dog_name, owner_name) בפורמט YYYY-MM-DD, ואז save_summary.\n' +
    '• אם לקוח חדש: אסוף/אספי שם כלב, מין (זכר/נקבה), גזע, גיל, גודל, עיקור/סירוס, חיסונים, פרעושים/קרציות, אלרגיות, בריאות/תרופות, ' +
    'שאל/י את המין לפני שאלת העיקור/סירוס, והתאם/י את הניסוח למין: לזכר "האם הוא מסורס?", לנקבה "האם היא מעוקרת?". ' +
    'התאמה לכלבים אחרים, עבר תוקפנות, אוכל ולו"ז — הכול בזרימה טבעית, שאלה אחת בכל פעם, לא כרשימה. ' +
    'ואז קרא/י ל-get_available_slots והצג/י 3–5 מועדים. ' +
    'כשהלקוח בוחר מועד — גם בניסוח חופשי (למשל "חמישי ב-6" או "השני ב-4") — התאם/י אותו למועד המתאים מהרשימה שהצגת (שים/י לב: "ב-6" פירושו השעה 18:00, "ב-4" זה 16:00 וכו\'), אשר/י בקצרה וקרא/י מיד ל-book_meeting (slot_id, dog_name, owner_name). בקש/י הבהרה רק אם באמת אין מועד מתאים. ' +
    'לאחר קביעת פגישת ההיכרות ללקוח חדש: שאל/י לאילו תאריכים הוא צריך את השהייה, וקרא/י ל-check_dates (start_date, end_date, owner_name) בפורמט YYYY-MM-DD כדי לבדוק ביומן אם פנוי וכמה כלבים כבר בטווח — ומסור/י לו את התוצאה. ' +
    '*אל תשריין/י תאריכי שהייה ואל תקרא/י ל-book_boarding ללקוח חדש.* ' +
    'ואז אמור/י בדיוק: "שיריון תאריכי השהייה יבוצע לאחר פגישת ההיכרות, אחרי שנכיר את ' + '{dogName}' + ' ונראה שהכל מסתדר יפה." (החלף/י {dogName} בשם הכלב), קרא/י ל-save_summary וסיים/י בברכה.\n' +
    'הלקוח יכול לשאול שאלות פתוחות בכל שלב — ענה/י לפי "מידע על הפנסיון" למטה ואל תמציא/י עובדות.\n\nמידע על הפנסיון:\n' + K.knowledge();

  const TOOLS = [
    { name: 'lookup_customer', description: 'בודק אם הפונה הוא לקוח קיים לפי שם הבעלים.', input_schema: { type: 'object', properties: { owner_name: { type: 'string' } }, required: ['owner_name'], additionalProperties: false } },
    { name: 'get_available_slots', description: 'מחזיר מועדי פגישות היכרות פנויים.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'book_meeting', description: 'משריין פגישת היכרות.', input_schema: { type: 'object', properties: { slot_id: { type: 'string' }, dog_name: { type: 'string' }, owner_name: { type: 'string' } }, required: ['slot_id'], additionalProperties: true } },
    { name: 'check_dates', description: 'בודק ביומן אם תאריכי שהייה פנויים וכמה כלבים כבר רשומים בטווח (בלי לשריין).', input_schema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' }, owner_name: { type: 'string' } }, required: ['start_date', 'end_date'], additionalProperties: true } },
    { name: 'book_boarding', description: 'משריין שהייה בפנסיון לטווח תאריכים (רק ללקוח חוזר).', input_schema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' }, dog_name: { type: 'string' }, owner_name: { type: 'string' } }, required: ['start_date', 'end_date'], additionalProperties: true } },
    { name: 'save_summary', description: 'שומר סיכום קליטה מלא לבעל הפנסיון. חובה למלא כל שדה שכבר ידוע לך מהשיחה — אל תשאיר/י ריק פרט שהלקוח כבר מסר.', input_schema: { type: 'object', properties: {
      owner_name: { type: 'string', description: 'שם הבעלים' },
      dog_name: { type: 'string', description: 'שם הכלב' },
      sex: { type: 'string', description: 'מין: "זכר" או "נקבה"' },
      breed: { type: 'string', description: 'גזע' },
      age: { type: 'string', description: 'גיל' },
      size: { type: 'string', description: 'גודל (קטן/בינוני/גדול)' },
      neutered: { type: 'string', description: 'מעוקר/מסורס' },
      vaccinated: { type: 'string', description: 'חיסונים בתוקף' },
      flea_tick: { type: 'string', description: 'טיפול פרעושים/קרציות' },
      allergies: { type: 'string', description: 'אלרגיות (מזון/תרופות/סביבה). אם אין — "אין"' },
      health: { type: 'string', description: 'מצב בריאות/תרופות' },
      breed_en: { type: 'string', description: 'שם הגזע באנגלית לחיפוש תמונה, למשל: labrador, poodle, maltese, husky' },
      with_dogs: { type: 'string', description: 'התאמה לכלבים אחרים' },
      aggression: { type: 'string', description: 'עבר תוקפנות' },
      food: { type: 'string', description: 'סוג אוכל' },
      schedule: { type: 'string', description: 'לו"ז/הרגלים' },
      meeting: { type: 'string', description: 'מועד פגישת ההיכרות שנקבע' },
      boarding_start: { type: 'string', description: 'תחילת שהייה שנשוריינה (לקוח חוזר), YYYY-MM-DD' },
      boarding_end: { type: 'string', description: 'סוף שהייה שנשוריינה (לקוח חוזר), YYYY-MM-DD' },
      requested_start: { type: 'string', description: 'תחילת תאריכים מבוקשים (לאישור בפגישה), YYYY-MM-DD' },
      requested_end: { type: 'string', description: 'סוף תאריכים מבוקשים (לאישור בפגישה), YYYY-MM-DD' }
    }, additionalProperties: true } }
  ];

  async function runTool(name, input) {
    if (name === 'lookup_customer') {
      const ret = S.isReturning(input.owner_name);
      const prev = S.summaryForOwner ? S.summaryForOwner(input.owner_name) : null;
      return {
        returning: ret || !!prev,
        last_dog: (prev && prev.dogName) || (ret ? S.lastDogFor(input.owner_name) : ''),
        known: prev ? { dog_name: prev.dogName, breed: prev.breed, age: prev.age, size: prev.size, food: prev.food, allergies: prev.allergies } : null
      };
    }
    if (name === 'get_available_slots') {
      if (window.BoarDogCloud && window.BoarDogCloud.refresh) { try { await window.BoarDogCloud.refresh(); } catch (e) {} }
      return { slots: S.deriveSlots().slice(0, 6).map(s => ({ id: s.id, label: s.label })) };
    }
    if (name === 'book_meeting') {
      const slot = S.findSlot(input.slot_id);
      if (!slot) return { ok: false, reason: 'מועד לא תקין — קרא שוב ל-get_available_slots' };
      S.addMeeting({ date: slot.date, time: slot.time, dogName: input.dog_name || '', ownerName: input.owner_name || '', customerId: S.customerId() });
      return { ok: true, booked: slot.label };
    }
    if (name === 'check_dates') {
      const r = S.dogsInRange(input.start_date, input.end_date);
      const cap = S.capacity();
      // קישור התאריכים המבוקשים לפגישה האחרונה של אותו בעלים (לאישור בפגישה)
      const n = String(input.owner_name || '').trim().toLowerCase();
      const mine = S.meetings().filter(m => String(m.ownerName || '').trim().toLowerCase() === n);
      const last = mine[mine.length - 1];
      if (last) { last.requestedStart = input.start_date; last.requestedEnd = input.end_date; S.updateMeeting(last); }
      return { available: r.peak < cap, dogs_in_range: r.peak, capacity: cap };
    }
    if (name === 'book_boarding') {
      S.addBoarding({ dogName: input.dog_name || '', ownerName: input.owner_name || '', start: input.start_date, end: input.end_date, customerId: S.customerId() });
      return { ok: true, from: input.start_date, to: input.end_date };
    }
    if (name === 'save_summary') return { ok: true };
    return { error: 'unknown tool' };
  }

  // ממיר את פלט save_summary (snake_case) למבנה שהדוח מצפה לו, ומשלים
  // פרטים מנתוני היומן שהבוט שריין בפועל (פגישה/שהייה) כדי שהדוח לא יהיה חסר
  function buildSummary(input) {
    input = input || {};
    const cid = S.customerId();
    const prior = S.getSummary ? (S.getSummary(cid) || {}) : {}; // לקוח חוזר — פרטים משיחה קודמת
    const m = {
      ownerName: input.owner_name, dogName: input.dog_name, sex: input.sex, breed: input.breed, breedEn: input.breed_en,
      age: input.age, size: input.size, neutered: input.neutered, vaccinated: input.vaccinated,
      fleaTick: input.flea_tick, allergies: input.allergies, health: input.health, withDogs: input.with_dogs,
      aggression: input.aggression, food: input.food, schedule: input.schedule, meeting: input.meeting,
      boardingStart: input.boarding_start, boardingEnd: input.boarding_end,
      requestedStart: input.requested_start, requestedEnd: input.requested_end
    };
    const mtg = S.meetings().filter(x => x.customerId === cid).slice(-1)[0];
    if (mtg) {
      m.ownerName = m.ownerName || mtg.ownerName;
      m.dogName = m.dogName || mtg.dogName;
      m.breed = m.breed || mtg.breed;
      m.meeting = m.meeting || (mtg.date ? mtg.date + (mtg.time ? ' ' + mtg.time : '') : '');
      m.requestedStart = m.requestedStart || mtg.requestedStart;
      m.requestedEnd = m.requestedEnd || mtg.requestedEnd;
    }
    const brd = S.boardings().filter(x => x.customerId === cid).slice(-1)[0];
    if (brd) {
      m.boardingStart = m.boardingStart || brd.start;
      m.boardingEnd = m.boardingEnd || brd.end;
      m.dogName = m.dogName || brd.dogName;
      m.ownerName = m.ownerName || brd.ownerName;
    }
    Object.keys(m).forEach(k => { if (m[k] == null || m[k] === '') delete m[k]; });
    // מיזוג עם פרטים קודמים (לקוח חוזר) — מה שנמסר עכשיו גובר
    const out = Object.assign({}, prior, m, { customerId: cid });
    delete out.id; delete out.updatedAt;
    try { if (S.saveSummary) S.saveSummary(out); } catch (e) {} // שמירה מתמשכת + סנכרון
    return out;
  }

  function AiBot(io, saved) {
    saved = saved || {};
    const cfg = io.cfg || {};
    const messages = Array.isArray(saved.messages) ? saved.messages : [];
    let lastSummary = saved.lastSummary || null;
    let lastBotText = saved.lastBotText || ''; // השאלה/הודעה האחרונה שהבוט שלח — לחזרה עליה אם ה-AI נופל
    function getState() { return { messages, lastSummary, lastBotText }; }

    function dynamicSystem() {
      const p = S.profile() || {};
      let extra = '';
      if (p.description) extra += `\n\nמאפייני הפנסיון (כפי שהגדיר ${K.ownerName}):\n${p.description}`;
      extra += `\n\nתפוסה מרבית: ${S.capacity()} כלבים בו-זמנית. אם בתאריכים המבוקשים כבר מלאה התפוסה — יידע/י את הלקוח שהפנסיון מלא באותם תאריכים.`;
      extra += `\n\nאם הלקוח שואל על מחיר או הצעת מחיר — חשב/י לפי מדיניות המחירים שבתיאור הפנסיון למעלה (כולל מדרגות/עונות אם צוינו) ומספר הימים המבוקשים.`;
      return SYSTEM + extra;
    }
    // תיקון היסטוריית ההודעות לפני שליחה ל-Claude, כדי למנוע 400:
    //  1) הסרת בלוקי "חשיבה" (thinking) שנשארו מהרצות Opus קודמות.
    //  2) הסרת בלוקי tool_use "יתומים" (בלי tool_result תואם — קורה כשתשובה
    //     נחתכה ב-max_tokens באמצע קריאת כלי) ובלוקי tool_result יתומים.
    //  3) השמטת הודעות שנשארו ללא תוכן.
    function sanitize(msgs) {
      // אילו tool_use_id באמת קיבלו tool_result, ולהפך
      const resultIds = new Set(), useIds = new Set();
      msgs.forEach(m => {
        if (Array.isArray(m.content)) m.content.forEach(b => {
          if (b && b.type === 'tool_result' && b.tool_use_id) resultIds.add(b.tool_use_id);
          if (b && b.type === 'tool_use' && b.id) useIds.add(b.id);
        });
      });
      const out = [];
      msgs.forEach(m => {
        if (!Array.isArray(m.content)) { if (m.content) out.push(m); return; }
        const c = m.content.filter(b => {
          if (!b || b.type === 'thinking' || b.type === 'redacted_thinking') return false;
          if (b.type === 'tool_use') return resultIds.has(b.id);        // רק אם יש תוצאה תואמת
          if (b.type === 'tool_result') return useIds.has(b.tool_use_id); // רק אם יש קריאה תואמת
          return true;
        });
        if (c.length) out.push({ role: m.role, content: c });
      });
      return out;
    }
    async function call() {
      const payload = { system: dynamicSystem(), tools: TOOLS, messages: sanitize(messages) };
      return cfg.proxyUrl ? callProxy(cfg.proxyUrl, payload) : callClaude(cfg.key, payload);
    }
    // ניסיונות חוזרים לשגיאות זמניות (עומס 529 / מגבלת קצב 429 / רשת) לפני ויתור
    async function callWithRetry() {
      let lastErr;
      for (let a = 0; a < 4; a++) {
        try { return await call(); }
        catch (e) { lastErr = e; if (a < 3) await new Promise(r => setTimeout(r, 800 * Math.pow(2, a))); }
      }
      throw lastErr;
    }
    // anchor = אורך ההיסטוריה לפני התור הנוכחי — לשחזור נקי אם ה-AI נכשל
    async function loop(anchor) {
      io.typing(true);
      let guard = 0;
      while (guard++ < 10) {
        let res;
        try {
          res = await callWithRetry();
        } catch (e) {
          io.typing(false);
          try { console.warn('[BoarDog] AI call failed:', e && e.message, e && e.detail); } catch (_) {}
          // קוד שגיאה קצר לאבחון (מוצג ללקוח בסוגריים)
          const code = (e && e.status) ? (' (שגיאה ' + e.status + ')') : (e && e.message ? ' (' + e.message + ')' : '');
          // שומרים את השיחה: חוזרים למצב תקין אחרון וחוזרים על השאלה הקודמת (בלי להתחיל מחדש)
          if (typeof anchor === 'number') messages.length = anchor;
          io.bot({ text: lastBotText
            ? 'סליחה, הייתה לי תקלה רגעית 🙏' + code + ' נחזור רגע לשאלה:\n' + lastBotText
            : 'סליחה, הייתה לי תקלה רגעית 🙏' + code + ' אפשר לשלוח שוב?' });
          return;
        }
        messages.push({ role: 'assistant', content: res.content });
        const texts = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (texts) { lastBotText = texts; io.bot({ text: texts }); }
        const toolUses = res.content.filter(b => b.type === 'tool_use');
        if (res.stop_reason === 'tool_use' && toolUses.length) {
          const results = await Promise.all(toolUses.map(async tu => {
            if (tu.name === 'save_summary') lastSummary = buildSummary(tu.input || {});
            return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(await runTool(tu.name, tu.input || {})) };
          }));
          messages.push({ role: 'user', content: results });
          continue;
        }
        break;
      }
      io.typing(false);
      if (lastSummary) io.done({ kennel: K.name, answers: lastSummary });
    }
    return {
      start() { const a = messages.length; messages.push({ role: 'user', content: 'שלום' }); loop(a); },
      input(text) { const a = messages.length; messages.push({ role: 'user', content: text }); loop(a); },
      pickSlot(id) { const a = messages.length; const s = S.findSlot(id); messages.push({ role: 'user', content: 'אני בוחר/ת: ' + (s ? s.label : id) }); loop(a); },
      boarding(start, end) { const a = messages.length; messages.push({ role: 'user', content: `תאריכי השהייה: מ-${start} עד ${end}` }); loop(a); },
      getState,
      mode: 'ai'
    };
  }

  async function httpErr(prefix, res) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (e) {}
    const err = new Error(prefix + ' ' + res.status);
    err.status = res.status; err.detail = detail;
    return err;
  }
  async function callProxy(url, payload) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw await httpErr('proxy', res);
    return res.json();
  }
  async function callClaude(key, payload) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2048, thinking: { type: 'disabled' }, system: payload.system, tools: payload.tools, messages: payload.messages })
    });
    if (!res.ok) throw await httpErr('claude', res);
    return res.json();
  }

  global.BoarDogBot = { ScriptedBot, AiBot };
})(window);
