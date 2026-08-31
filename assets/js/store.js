/* =============================================================
   BoarDog – מאגר משותף (localStorage) לצד הלקוח וצד הפנסיון
   • availability – זמינות שבועית קבועה לפגישות היכרות (יום→שעות)
   • meetings     – פגישות היכרות שנקבעו
   • boardings    – שהיות שנשוריינו (טווח תאריכים לכל כלב)
   באב-טיפוס הכול בדפדפן; במוצר אמיתי – שרת משותף.
   ============================================================= */
(function (global) {
  'use strict';

  const K = { avail: 'boardog.availability', meet: 'boardog.meetings', board: 'boardog.boardings' };
  const load = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const pad = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => new Date(s + 'T00:00:00');
  const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // זמינות שבועית קבועה: מפה weekday(0-6) → מערך שעות. ברירת מחדל: א'-ה', 16:00 ו-18:00
  function defaultAvail() { return { 0: [16, 18], 1: [16, 18], 2: [16, 18], 3: [16, 18], 4: [16, 18], 5: [], 6: [] }; }

  const Store = {
    DOW, key, parse,
    availability: () => load(K.avail, defaultAvail()),
    setAvailability: (cfg) => save(K.avail, cfg),

    meetings: () => load(K.meet, []),
    boardings: () => load(K.board, []),

    // חלונות פנויים לפגישת היכרות ל-N הימים הקרובים (לפי הזמינות, פחות מה שכבר נקבע)
    deriveSlots(days) {
      days = days || 14;
      const avail = Store.availability();
      const taken = new Set(Store.meetings().map(m => m.date + ' ' + m.time));
      const now = new Date();
      const out = [];
      for (let d = 1; d <= days && out.length < 8; d++) {
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
        const hours = avail[date.getDay()] || [];
        hours.forEach(h => {
          const dk = key(date), tm = pad(h) + ':00';
          if (taken.has(dk + ' ' + tm)) return;
          out.push({ id: dk + '_' + h, date: dk, time: tm, label: `יום ${DOW[date.getDay()]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)} בשעה ${tm}` });
        });
      }
      return out;
    },
    findSlot(id) { return Store.deriveSlots(21).find(s => s.id === id) || null; },

    addMeeting(m) {
      const list = Store.meetings();
      const rec = Object.assign({ id: uid() }, m);
      list.push(rec); save(K.meet, list); return rec;
    },
    addBoarding(b) {
      const list = Store.boardings();
      const rec = Object.assign({ id: uid() }, b);
      list.push(rec); save(K.board, list); return rec;
    },
    removeMeeting(id) { save(K.meet, Store.meetings().filter(m => m.id !== id)); },
    removeBoarding(id) { save(K.board, Store.boardings().filter(b => b.id !== id)); },

    // האם תאריך (Date) נמצא בתוך טווח שהייה
    boardingsOn(date) {
      const dk = key(date);
      return Store.boardings().filter(b => dk >= b.start && dk <= b.end);
    },
    meetingsOn(date) {
      const dk = key(date);
      return Store.meetings().filter(m => m.date === dk);
    },
    // כלבים שיהיו בפנסיון בטווח [start,end] (מחרוזות YYYY-MM-DD)
    dogsInRange(start, end) {
      const s = start <= end ? start : end, e = start <= end ? end : start;
      const overlapping = Store.boardings().filter(b => b.start <= e && b.end >= s);
      // מקסימום כלבים בו-זמנית בטווח
      let peak = 0; const days = [];
      const d0 = parse(s), d1 = parse(e);
      for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
        const n = Store.boardingsOn(new Date(d)).length;
        peak = Math.max(peak, n); days.push({ date: key(new Date(d)), n });
      }
      return { dogs: overlapping.map(b => ({ dog: b.dogName, owner: b.ownerName, start: b.start, end: b.end })), total: overlapping.length, peak, days };
    },

    reset() { [K.meet, K.board].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); }
  };

  global.BoarDogStore = Store;
})(window);
