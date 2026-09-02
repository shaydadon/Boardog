# BoarDog — מעבר לשרת נתונים + נעילת RLS

מסמך זה מתאר את המעבר מגישת anon ישירה ל-Supabase, ל**שרת נתונים יחיד**
(`boardog-data.js`) שמחזיק את `service_role` ומאמת כל בקשה — ואז נעילת RLS
מלאה כך שאף אחד לא יכול לגשת ל-DB ישירות מהדפדפן.

**חשוב — הסדר קריטי.** אל תריצו את שלב RLS (שלב 3) לפני ששלב 2 עובד,
אחרת האפליקציה תישבר (הלקוחות עדיין ניגשים ב-anon עד שמחליפים אותם).

---

## שלב 1 — פריסת שרת הנתונים  ✅ (הקוד מוכן)

```bash
cd worker
wrangler deploy --config wrangler.data.toml
wrangler secret put SUPABASE_SERVICE_ROLE --config wrangler.data.toml
#   → הדביקו את מפתח service_role מ-Supabase (Settings → API)
```

תקבלו כתובת כמו `https://boardog-data.<שם>.workers.dev`. **שלחו לי אותה** —
היא תוטמע ב-`cloud.js` בשלב 2.

**מה השרת עושה:**
- **בעלים** (נשלח JWT של Supabase): גישה מלאה לפנסיון שלו בלבד (`k_<user id>`).
- **לקוח** (בלי טוקן, שולח `kennel`): קריאת זמינות/מאפיינים, קריאת פגישות/
  שהיות (לחישוב חלונות), יצירת פגישה/שהייה, שמירת/קריאת הדוח שלו בלבד,
  וקריאת הודעות שנשלחו אליו. אינו יכול למחוק, לשנות מאפיינים, או לקרוא
  דוחות של לקוחות אחרים.

---

## שלב 2 — העברת הלקוחות לשרת (Phase הבא)

1. הבעלים יעבור מ-Google Identity Services ל-**Supabase Auth (Google)** כדי
   שיהיה לו JWT מתמשך שהשרת יכול לאמת (אותו פרויקט Supabase של Excerly).
2. `cloud.js` יתחבר ל-`boardog-data` במקום ל-Supabase ישירות (בעלים עם טוקן,
   לקוח עם `kennel`). ה-realtime יוחלף ב-polling (כבר קיים כרשת ביטחון).
3. בדיקה מקצה לקצה שהכל עובד דרך השרת.

---

## שלב 3 — נעילת RLS (רק אחרי ששלב 2 עובד ונפרס!)

לאחר ששום דפדפן לא ניגש יותר ב-anon, מריצים ב-Supabase → SQL Editor:

```sql
-- הפעלת RLS על כל הטבלאות (ברירת המחדל: דוחה הכל למי שאינו service_role)
alter table availability      enable row level security;
alter table kennel_profile    enable row level security;
alter table meetings          enable row level security;
alter table boardings         enable row level security;
alter table summaries         enable row level security;
alter table customer_messages enable row level security;

-- מחיקת מדיניות ה-anon הפתוחה שהוגדרה בפרוטוטיפ (אם קיימת), למשל:
-- drop policy if exists "anon all meetings" on meetings;   (וכן לשאר הטבלאות)

-- אין צורך ב-policies חדשות: service_role עוקף RLS לגמרי, ורק שרת הנתונים
-- משתמש בו. anon לא יקבל כלום → אין גישה ישירה מהדפדפן.
```

בדקו: קריאה ישירה עם מפתח anon לטבלה כלשהי צריכה להחזיר 0 שורות/שגיאת
הרשאה, בעוד האפליקציה (דרך השרת) ממשיכה לעבוד רגיל.

> אם משהו נשבר אחרי שלב 3 — אפשר לחזור זמנית עם
> `alter table <name> disable row level security;` עד לתיקון.
