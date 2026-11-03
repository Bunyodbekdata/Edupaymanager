# EduPay Manager

**O'quv markazlari va til maktablari uchun o'quvchilarning oylik to'lov muddatlarini raqamli yig'ish, guruhlash va Excel hisobotlarini shakllantirish tizimi.**

---

## 1. Loyiha haqida qisqacha

**EduPay Manager** o'quv markazi administratorlarining har oy boshida guruhlarga kirib, qog'oz tarqatib, o'quvchilarning qachon to'lov qilishini yozdirib chiqish va ularni qo'lda boshqa jadvalga ko'chirish muammosini to'liq avtomatlashtiradi.

- **O'quvchilar uchun (Ommaviy sahifa):** Ro'yxatdan o'tish talab etilmaydi. Telegram guruhlarga yuborilgan yagona havola orqali kirib, o'z o'qituvchisi va guruhini tanlaydi, ism-familiyasi hamda to'lov qilmoqchi bo'lgan sanasini belgilab yuboradi.
- **Administrator uchun (Himoyalangan boshqaruv paneli):** Barcha kelib tushgan ma'lumotlar avtomatik ravishda o'qituvchi, guruh va oy bo'yicha alifbo tartibida saralanadi, guruh ro'yxati bilan solishtiriladi, A4 formatda chop etiladi yoki har bir guruh alohida varaqda (sheet) joylashgan tayyor **Excel (.xlsx)** fayl sifatida yuklab olinadi.

---

## 2. Texnologiyalar to'plami

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide React
- **Backend API:** Node.js + Express (`server.ts`)
- **Ma'lumotlar bazasi:**
  - Mahalliy va Konteyner muhitida: **Node.js SQLite (`node:sqlite`, `data/edupay.sqlite`)** — WAL rejimi va Foreign Key cheklovlari bilan to'liq doimiy (persistent) relyatsion baza.
  - Tashqi bulutli joylashtirish uchun: **Supabase PostgreSQL sxemasi va RLS siyosatlari** (`supabase/migrations/001_edupay_schema_and_rls.sql`).
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

4. **Unit testlarni tekshirish:**
   ```bash
   npx --yes tsx --test src/utils/edupayLogic.test.ts
   ```

---

## 4. Birinchi administrator hisobi va tizimga kirish

Ilova birinchi marta ishga tushganda ma'lumotlar bazasi avtomatik ravishda `.env` faylidagi `ADMIN_INITIAL_EMAIL` va `ADMIN_INITIAL_PASSWORD` qiymatlari asosida dastlabki administratorni (`scrypt` xeshlangan parol bilan) yaratadi:

- **Standart Login:** `admin@edupay.uz`
- **Standart Parol:** `EduPay2026!`

Administrator tizimga kirgach, **"Sozlamalar"** bo'limi orqali o'z ism-familiyasini va maxfiy parolini istalgan vaqtda o'zgartirishi mumkin. Xavfsizlik maqsadida ommaviy ro'yxatdan o'tish sahifasi mavjud emas.

---

## 5. Ma'lumotlar bazasini sozlash

### A. Standart SQLite rejimi (Avtomatik)
Hech qanday qo'shimcha sozlama talab qilinmaydi. Server `data/edupay.sqlite` faylini avtomatik yaratadi va barcha 7 ta jadvalni (`admins`, `teachers`, `groups`, `collection_periods`, `submissions`, `student_rosters`, `audit_logs`) relyatsion indekslar bilan shakllantiradi.

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
