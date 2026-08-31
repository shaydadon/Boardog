/* =============================================================
   BoarDog – נתוני הפנסיון (מוק) + סכימת התשאול
   באב-טיפוס הכול בזיכרון; במוצר אמיתי זה יגיע מ-DB/יומן הפנסיון.
   ============================================================= */
(function (global) {
  'use strict';

  const KENNEL = {
    name: 'פנסיון הכלב המאושר',
    ownerName: 'רועי',
    // חלונות זמן פנויים לפגישת היכרות (נוצרים דינמית מהיום קדימה)
    slots: []
  };

  const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const pad = n => String(n).padStart(2, '0');

  // בונה חלונות זמן ל-10 הימים הקרובים (16:00 ו-18:00), חלקם "תפוסים"
  function buildSlots() {
    const slots = [];
    const now = new Date();
    let id = 1;
    for (let d = 1; d <= 10 && slots.length < 12; d++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      if (date.getDay() === 6) continue; // סוגרים בשבת
      [16, 18].forEach(hour => {
        // מדלגים באקראי על חלק מהחלונות כדי לדמות תפוסה
        if ((d + hour) % 3 === 0) return;
        slots.push({
          id: 'S' + (id++),
          date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
          time: `${pad(hour)}:00`,
          label: `יום ${DOW[date.getDay()]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)} בשעה ${pad(hour)}:00`,
          booked: false
        });
      });
    }
    return slots;
  }

  KENNEL.slots = buildSlots();

  /* ---------- מאגר ידע על הפנסיון (לשאלות פתוחות) ---------- */
  KENNEL.info = {
    price: 'מחיר: 120 ₪ ליום. מעל 7 ימים — 100 ₪ ליום.',
    hours: 'שעות קבלה ואיסוף: א׳–ה׳ 08:00–19:00, ו׳ 08:00–13:00. בשבת סגור (אבל הכלבים כמובן איתנו 🙂).',
    bring: 'כדאי להביא: האוכל הרגיל של הכלב, מיטה/שמיכה מוכרת, צעצוע אהוב, ותרופות אם יש. קערות ומצעים יש אצלנו.',
    medical: 'דרישות רפואיות: חיסונים בתוקף (כלבת, משושה, שיעול כלבים) וטיפול עדכני נגד פרעושים וקרציות. כדאי להביא צילום של פנקס החיסונים.',
    sizes: 'אנחנו מקבלים כלבים בכל הגדלים, עם חצרות משחק נפרדות לפי גודל ואופי.',
    neuter: 'כלב/ה שאינם מעוקרים/מסורסים מתקבלים בתיאום מראש, עם השגחה והפרדה בעת הצורך.',
    updates: 'מקבלים עדכוני תמונות יומיים בוואטסאפ 📸 כדי שתהיו רגועים.',
    food: 'אנחנו מאכילים לפי ההנחיות שלכם ובלו״ז שאתם קובעים. אפשר להביא אוכל משלכם.',
    cancel: 'ביטול עד 48 שעות לפני מועד השהייה — ללא חיוב.',
    vet: 'יש לנו וטרינר בכוננות, ובמקרה חירום ניצור קשר מיידי ונפעל לפי ההנחיות שהשארתם.'
  };

  // שאלות נפוצות – לזיהוי מהיר במצב ההדגמה (בלי AI)
  KENNEL.FAQ = [
    { k: ['מחיר', 'עולה', 'עלות', 'כמה זה', 'תשלום', 'מחירון'], a: KENNEL.info.price },
    { k: ['שעות', 'שעה', 'מתי פתוח', 'קבלה', 'איסוף', 'שבת', 'סופ"ש', 'סופש'], a: KENNEL.info.hours },
    { k: ['להביא', 'מביא', 'מביאים', 'ציוד', 'אוכל להביא'], a: KENNEL.info.bring },
    { k: ['חיסון', 'חיסונים', 'רפואי', 'בריאות', 'וטרינר', 'כלבת'], a: KENNEL.info.medical + ' ' + KENNEL.info.vet },
    { k: ['גדול', 'גדולים', 'קטן', 'גודל', 'מקבלים', 'גזע'], a: KENNEL.info.sizes },
    { k: ['מעוקר', 'מסורס', 'עיקור', 'סירוס', 'ייחום', 'לא מעוקר'], a: KENNEL.info.neuter },
    { k: ['תמונות', 'תמונה', 'מצלמה', 'מצלמות', 'עדכון', 'לראות'], a: KENNEL.info.updates },
    { k: ['אוכל', 'האכלה', 'להאכיל', 'מזון', 'דיאטה'], a: KENNEL.info.food },
    { k: ['ביטול', 'לבטל', 'החזר', 'דמי ביטול'], a: KENNEL.info.cancel }
  ];

  // טקסט מרוכז למערכת ה-AI
  KENNEL.knowledge = () => Object.values(KENNEL.info).join('\n');

  const QWORDS = /^(כמה|מה|מהו|מהי|האם|איך|כיצד|מתי|איפה|היכן|יש|אפשר|למה|מדוע|מי|צריך|האם יש)\b/;
  KENNEL.isQuestion = (t) => /[?？]/.test(t) || QWORDS.test((t || '').trim());
  KENNEL.faqAnswer = (t) => {
    const s = (t || '').toLowerCase();
    const hit = KENNEL.FAQ.find(f => f.k.some(w => s.indexOf(w) !== -1));
    return hit ? hit.a : null;
  };

  KENNEL.availableSlots = () => KENNEL.slots.filter(s => !s.booked);
  KENNEL.findSlot = id => KENNEL.slots.find(s => s.id === id);
  KENNEL.book = (id) => {
    const s = KENNEL.findSlot(id);
    if (!s || s.booked) return false;
    s.booked = true;
    return true;
  };
  KENNEL.reset = () => { KENNEL.slots = buildSlots(); };

  /* ---------- סכימת התשאול (הזרימה המונחית) ---------- */
  // type: text / choice ; choices לכפתורי מענה מהיר
  const INTAKE = [
    { key: 'ownerName', q: 'נעים מאוד! 🐾 קודם כול — איך קוראים לך?', type: 'text' },
    { key: 'dogName', q: 'ואיך קוראים לכלב/ה שלך?', type: 'text' },
    { key: 'breed', q: 'איזה גזע {dogName}?', type: 'text' },
    { key: 'age', q: 'בן/בת כמה {dogName}? (אפשר בשנים)', type: 'text' },
    { key: 'size', q: 'מה הגודל בערך?', type: 'choice', choices: ['קטן', 'בינוני', 'גדול'] },
    { key: 'neutered', q: 'האם {dogName} מעוקר/ת או מסורס/ת?', type: 'choice', choices: ['כן', 'לא'] },
    { key: 'vaccinated', q: 'האם החיסונים בתוקף? (כלבת, משושה, שיעול כלבים)', type: 'choice', choices: ['כן, הכול בתוקף', 'חלק', 'לא בטוח/ה'] },
    { key: 'fleaTick', q: 'יש טיפול עדכני נגד פרעושים וקרציות?', type: 'choice', choices: ['כן', 'לא'] },
    { key: 'health', q: 'יש בעיות בריאות או תרופות שחשוב שנדע עליהן? (אם אין, כתבו "אין")', type: 'text' },
    { key: 'withDogs', q: 'איך {dogName} מסתדר/ת עם כלבים אחרים?', type: 'choice', choices: ['מצוין', 'בסדר', 'מעדיף/ה להתרחק'] },
    { key: 'aggression', q: 'האם היו בעבר אירועי תוקפנות או נשיכה?', type: 'choice', choices: ['לא', 'כן'] },
    { key: 'food', q: 'מה האוכל של {dogName} ובאיזה לו"ז? (מותג + כמה פעמים ביום)', type: 'text' },
    { key: 'dates', q: 'לאילו תאריכים בערך תרצו את השהייה בפנסיון?', type: 'text' }
  ];

  global.BoarDogKennel = { KENNEL, INTAKE };
})(window);
