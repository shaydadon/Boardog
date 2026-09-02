/* =============================================================
   BoarDog – רינדור דוח הקליטה (משותף ללקוח ולבעל הפנסיון)
   מציג כרטיס אינטראקטיבי עם תמונת גזע, אלרגיות ושאר הפרטים.
   בשני הצדדים משתמשים באותו BoarDogReport.render(summary).
   ============================================================= */
(function (global) {
  'use strict';

  const K = global.BoarDogKennel ? global.BoarDogKennel.KENNEL : null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* מיפוי גזעים נפוצים (עברית → נתיב תמונה ב-dog.ceo) */
  const BREEDS = {
    'מלטז': 'maltese', 'מלטזי': 'maltese', 'לברדור': 'labrador', 'גולדן': 'retriever/golden',
    'רטריבר': 'retriever/golden', 'פודל': 'poodle', 'רועה גרמני': 'germanshepherd', 'האסקי': 'husky',
    'צ׳יוואווה': 'chihuahua', "צ'יוואווה": 'chihuahua', 'בולדוג': 'bulldog/french', 'רוטוויילר': 'rottweiler',
    'בוקסר': 'boxer', 'ביגל': 'beagle', 'שיצו': 'shihtzu', 'שיה טסו': 'shihtzu',
    'יורקשייר': 'terrier/yorkshire', 'יורקי': 'terrier/yorkshire', 'קוקר': 'spaniel/cocker',
    'דלמטי': 'dalmatian', 'דוברמן': 'doberman', 'פאג': 'pug', 'מופס': 'pug', 'קולי': 'collie/border',
    'בורדר קולי': 'collie/border', 'קורגי': 'corgi/cardigan', 'דאשונד': 'dachshund', 'תחש': 'dachshund',
    'שנאוצר': 'schnauzer/miniature', 'אקיטה': 'akita', 'פומרניאן': 'pomeranian', 'שיבא': 'shiba',
    'גרייהאונד': 'greyhound', 'וויפט': 'whippet', 'ניופאונדלנד': 'newfoundland', 'סנט ברנרד': 'stbernard',
    'מסטיף': 'mastiff/bull', 'ווסטי': 'terrier/westhighland', 'פינצ׳ר': 'pinscher/miniature'
  };

  function slugFor(a) {
    if (a.breedEn) return String(a.breedEn).trim().toLowerCase().replace(/\s+/g, '/');
    const b = String(a.breed || '').trim();
    if (!b) return '';
    for (const heb in BREEDS) { if (BREEDS[heb] && b.indexOf(heb) !== -1) return BREEDS[heb]; }
    return '';
  }

  async function fetchBreedImage(a) {
    const slug = slugFor(a || {});
    if (!slug) return '';
    try {
      const r = await fetch('https://dog.ceo/api/breed/' + slug + '/images/random');
      const j = await r.json();
      if (j && j.status === 'success' && j.message) return j.message;
    } catch (e) {}
    return '';
  }

  function rows(a) {
    const neutLabel = /נקבה/.test(a.sex || '') ? 'מעוקרת' : (/זכר/.test(a.sex || '') ? 'מסורס' : 'מעוקר/מסורס');
    return [
      ['מין', a.sex], ['גיל', a.age], ['גודל', a.size], [neutLabel, a.neutered],
      ['חיסונים', a.vaccinated], ['פרעושים/קרציות', a.fleaTick],
      ['בריאות', a.health], ['עם כלבים', a.withDogs], ['תוקפנות בעבר', a.aggression],
      ['אוכל', a.food], ['לו״ז', a.schedule],
      ['תאריכי שהייה', a.boardingStart ? (a.boardingStart + ' – ' + a.boardingEnd) : null],
      ['תאריכים מבוקשים', a.requestedStart ? (a.requestedStart + ' – ' + a.requestedEnd) : null],
      ['פגישת היכרות', a.meeting]
    ].filter((r) => r[1]);
  }

  function isNoAllergy(v) { return /^\s*(אין|לא|ללא|none|no)\b/i.test(String(v || '')); }

  function render(summary, opts) {
    opts = opts || {};
    const a = (summary && summary.answers) ? summary.answers : (summary || {});
    const kName = (K && K.name) || 'הפנסיון';
    const card = document.createElement('div');
    card.className = 'summary-card report';

    const title = a.dogName ? (a.dogName + (a.ownerName ? ' · ' + a.ownerName : '')) : (a.ownerName || 'לקוח');
    const allergyBadge = (a.allergies && !isNoAllergy(a.allergies))
      ? `<div class="sc-allergy">⚠️ אלרגיות: ${esc(a.allergies)}</div>` : '';

    card.innerHTML =
      `<div class="sc-head">📋 סיכום קליטה — ${esc(kName)}</div>` +
      `<div class="sc-hero">` +
        `<div class="sc-photo" data-photo><span class="sc-paw">🐶</span></div>` +
        `<div class="sc-id"><b>${esc(title)}</b>${a.breed ? `<span>${esc(a.breed)}</span>` : ''}</div>` +
      `</div>` +
      allergyBadge +
      rows(a).map((r) => `<div class="sc-row"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('') +
      (opts.note === false ? '' : `<div class="sc-note">✅ נשמר אוטומטית לבעל הפנסיון — כולל לפעם הבאה שהלקוח יחזור.</div>`);

    // תמונת גזע — נטענת אסינכרונית; אם לא נמצא גזע מזוהה נשארת אימוג'י
    const ph = card.querySelector('[data-photo]');
    if (ph) fetchBreedImage(a).then((url) => {
      if (!url) return;
      const img = new Image();
      img.onload = () => { ph.style.backgroundImage = 'url("' + url + '")'; ph.classList.add('has-img'); };
      img.src = url;
    });
    return card;
  }

  /* מודאל צף (לצד בעל הפנסיון — פתיחת דוח מהיומן) */
  function openModal(summary) {
    if (!summary) return null;
    const ov = document.createElement('div');
    ov.className = 'report-overlay';
    const modal = document.createElement('div');
    modal.className = 'report-modal';
    const close = document.createElement('button');
    close.className = 'report-close'; close.textContent = '✕'; close.setAttribute('aria-label', 'סגור');
    modal.appendChild(close);
    modal.appendChild(render(summary, { note: false }));
    ov.appendChild(modal);
    const dismiss = () => { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', (e) => { if (e.target === ov) dismiss(); });
    close.addEventListener('click', dismiss);
    document.body.appendChild(ov);
    return ov;
  }

  /* קידוד/פענוח הודעת "דוח" בין הבעלים ללקוח (עוברת בערוץ ההודעות הרגיל) */
  const MSG_PREFIX = '⁣REPORT⁣';
  function encodeReportMessage(text, summary) {
    return MSG_PREFIX + JSON.stringify({ text: text || '', summary: summary || {} });
  }
  function decodeReportMessage(raw) {
    if (typeof raw !== 'string' || raw.indexOf(MSG_PREFIX) !== 0) return null;
    try { return JSON.parse(raw.slice(MSG_PREFIX.length)); } catch (e) { return null; }
  }

  global.BoarDogReport = { render, openModal, fetchBreedImage, encodeReportMessage, decodeReportMessage };
})(window);
