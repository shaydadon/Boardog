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
