# EduPay Manager

**O'quv markazlari va til maktablari uchun o'quvchilarning oylik to'lov muddatlarini raqamli yig'ish, guruhlash va Excel hisobotlarini shakllantirish tizimi.**

---

## 1. Loyiha haqida qisqacha

**EduPay Manager** o'quv markazi administratorlarining har oy boshida guruhlarga kirib, qog'oz tarqatib, o'quvchilarning qachon to'lov qilishini yozdirib chiqish va ularni qo'lda boshqa jadvalga ko'chirish muammosini to'liq avtomatlashtiradi.

- **O'quvchilar uchun (Kod orqali himoyalangan ommaviy shakl):** O'quvchilar o'quv markazi tomonidan berilgan maxsus **O'quvchi kirish kodi** (standart: `EDU-2026` yoki QR/Telegram havola orqali) yordamida shaklga kirib, o'z o'qituvchisi va guruhini tanlaydi, ism-familiyasi hamda to'lov qilmoqchi bo'lgan sanasini belgilab yuboradi. O'quvchi kodi bilan administrator paneliga o'tish qat'iyan bloklangan (`403 Forbidden`).
- **Administrator uchun (Kuchaytirilgan kod bilan himoyalangan boshqaruv paneli):** Boshqaruv paneliga kirish uchun administrator **Login**, **Shaxsiy parol** va **Kuchaytirilgan Administrator Maxfiy Kodi**ni kiritishi shart. Barcha kelib tushgan ma'lumotlar avtomatik ravishda o'qituvchi, guruh va oy bo'yicha alifbo tartibida saralanadi, guruh ro'yxati bilan solishtiriladi, A4 formatda chop etiladi yoki har bir guruh alohida varaqda (sheet) joylashgan tayyor **Excel (.xlsx)** fayl sifatida yuklab olinadi.

---

## 2. Texnologiyalar to'plami

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide React
- **Backend API:** Node.js + Express (`server.ts`)
- **Ma'lumotlar bazasi:**
  - Mahalliy va Konteyner muhitida: **Node.js SQLite (`node:sqlite`, `data/edupay.sqlite`)** — WAL rejimi va Foreign Key cheklovlari bilan to'liq doimiy (persistent) relyatsion baza.
  - Tashqi bulutli joylashtirish uchun: **Supabase PostgreSQL sxemasi va RLS siyosatlari** (`supabase/migrations/001_edupay_schema_and_rls.sql`).
- **QR Kod generatori:** ISO/IEC 18004 standarti bo'yicha Reed-Solomon $GF(2^8)$ xatoliklarni tuzatish algoritmiga ega haqiqiy skanerlanadigan QR kod (`src/utils/qrCode.ts`).
- **Excel eksport va import:** `ExcelJS` (ko'p varaqli, ustunlari muzlatilgan, filtrli va chiroyli formatlangan `.xlsx` fayllar).
- **Validatsiya:** `Zod` hamda o'zbek lotin alifbosi uchun maxsus normalizatsiya va saralash algoritmlari.

---

## 3. O'rnatish va mahalliy ishga tushirish (Local Setup)

1. **Bog'liqliklarni o'rnatish:**
   ```bash
   npm install
   ```

2. **Muhit o'zgaruvchilarini sozlash (`.env`):**
   `.env.example` faylidan `.env` nusxa oling:
   ```bash
   cp .env.example .env
   ```

3. **Ilovani ishga tushirish:**
   ```bash
   npm run dev
   ```
   Ilova `http://localhost:3000` manzilida ishga tushadi.

4. **Avtomatlashtirilgan testlarni tekshirish:**
   ```bash
   npm test
   ```

---

## 4. Ikki darajali kirish tizimi (O'quvchi va Administrator kodlari)

Ilova ikki darajali qat'iy ajratilgan kirish tizimi bilan himoyalangan:

### A. O'quvchi kirish kodi (`/`)
- **Standart O'quvchi Kirish Kodi:** `EDU-2026` (`.env` dagi `STUDENT_ACCESS_CODE` yoki admin panelning **Sozlamalar** bo'limidan o'zgartiriladi).
- O'quvchi kodni kiritganda faqat `stu_...` prefiksli cheklangan o'quvchi seansi yaratiladi.
- Ushbu kod yoki seans orqali `/admin` sahifalariga yoki `/api/admin/*` API nuqtalariga murojaat qilinsa, server darhol `403 Forbidden` qaytaradi va xavfsizlik jurnaliga (`STUDENT_ADMIN_CROSSOVER_BLOCKED`) yozib qo'yadi.

### B. Administrator tizimga kirishi (`/admin/login`)
- **Standart Login:** `admin@edupay.uz`
- **Standart Parol:** `EduPay2026!`
- **Standart Kuchaytirilgan Administrator Maxfiy Kodi:** `ADM#EduPay$2026!Key` (`.env` dagi `ADMIN_SECURITY_CODE` yoki **Sozlamalar** bo'limidan o'zgartiriladi).
- Administrator maxfiy kodi kamida 10 ta belgidan iborat bo'lishi, katta harf, kichik harf, raqam va maxsus belgi qatnashishi hamda o'quvchi kodidan butunlay farq qilishi shart.

---

## 5. Ma'lumotlar bazasini sozlash

### A. Standart SQLite rejimi (Avtomatik)
Hech qanday qo'shimcha sozlama talab qilinmaydi. Server `data/edupay.sqlite` faylini avtomatik yaratadi va barcha jadvallarni (`admins`, `admin_sessions`, `student_sessions`, `access_control_config`, `teachers`, `groups`, `collection_periods`, `submissions`, `student_rosters`, `audit_logs`) relyatsion indekslar bilan shakllantiradi.

### B. Supabase PostgreSQL bilan sozlash (Ixtiyoriy)
Agar loyihani Supabase bulutli bazasiga ulamoqchi bo'lsangiz:
1. Supabase Dashboard -> SQL Editor bo'limini oching.
2. `supabase/migrations/001_edupay_schema_and_rls.sql` faylidagi SQL skriptni ishga tushiring.
3. `.env` fayliga `VITE_SUPABASE_URL` va `VITE_SUPABASE_ANON_KEY` qiymatlarini kiriting.

---

## 6. Production'ga joylashtirish (Deployment) va Maxsus Domen ulash

1. **Production build yaratish:**
   ```bash
   npm run build
   ```
2. **Production serverni ishga tushirish:**
   ```bash
   NODE_ENV=production npm start
   ```
3. **Maxsus domen (Custom Domain) ulash:**
   - Cloud Run, Render, Railway yoki VPS serveringizda ilovani `PORT=3000` da ishga tushiring.
   - DNS provayderingizda (masalan, Cloudflare) `A` yoki `CNAME` yozuvini serveringiz manziliga yo'naltiring.
   - `.env` faylidagi `APP_URL` o'zgaruvchisini yangi domeningizga (masalan, `https://tolov.oquvmarkaz.uz`) o'zgartiring.
