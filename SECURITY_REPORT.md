# EDUPAY MANAGER — XAVFSIZLIK AUDITI VA IKKI DARAJALI KIRISH NAZORATI HISOBOTI (SECURITY REPORT)

## 1. ANIQLANGAN VA BARTARAF ETILGAN XATOLIKLAR HAMDA ZAIFLIKLAR

Kod bazasini to'liq auditdan o'tkazish davomida quyidagi barcha texnik va xavfsizlik xatoliklari aniqlandi hamda to'liq bartaraf etildi:

1. **O'quvchi va Administrator uchun Ikki Darajali Kod Orqali Kirish Tizimi (`server.ts`, `src/server/db.ts`, `src/components/PublicStudentForm.tsx`, `src/components/AdminLogin.tsx`, `src/components/SettingsView.tsx`)**:
   - **Yechim:**
     - **O'quvchi kirish kodi (`student_access_code`, standart: `EDU-2026`):** O'quvchilar `/` sahifasidagi to'lov muddatini yuborish shakliga kirish uchun maxsus o'quvchi kodini kiritadilar (`POST /api/public/verify-code`). Kod tasdiqlangach, faqat `stu_` prefiksli va `role = 'student'` huquqiga ega cheklangan sessiya tokeni beriladi.
     - **O'quvchining Admin panelga o'tishini qat'iy bloklash:** Agar foydalanuvchi `stu_*` tokeni yoki o'quvchi kodi bilan `/api/admin/*` yoki `/api/auth/login` manziliga murojaat qilsa, server darhol **`403 Forbidden`** qaytaradi va `audit_logs` jadvaliga `STUDENT_ADMIN_CROSSOVER_BLOCKED` / `STUDENT_CODE_REJECTED_AT_ADMIN_LOGIN` hodisasini yozadi.
     - **Kuchaytirilgan Administrator Maxfiy Kodi (`admin_code`, standart: `ADM#EduPay$2026!Key`):** Administrator `/admin/login` sahifasida elektron pochta va paroldan tashqari kamida 10 ta belgidan iborat (katta va kichik harf, raqam hamda maxsus belgi qatnashgan va o'quvchi kodidan keskin farq qiluvchi) **Maxfiy Administrator Himoya Kodi**ni kiritishi shart.
2. **Ommaviy sahifa footer qismidagi yashirin `/admin/login` o'tish tugmalari (`src/App.tsx`, `src/components/PublicStudentForm.tsx`)**:
   - **Muammo:** `PublicStudentForm.tsx` footer qismidagi ikkita yozuv (`"Ma'lumotlar xavfsiz himoyalangan"` va `"EduPay Manager ©"`) bosilganda o'quvchini `/admin/login` sahifasiga olib o'tardi (`onSecretTrigger`).
   - **Yechim:** Footer qismidagi yashirin tugmalar oddiy bosilmaydigan matnga (`<div>`) aylantirildi va `onSecretTrigger` butunlay olib tashlandi.
3. **2FA (TOTP) Base32 dekodlash xatoligi (`src/server/db.ts`)**:
   - **Muammo:** `decodeBase32()` funksiyasi RFC 4648 standarti bo'yicha har bir Base32 belgisini 5-bitli oqim sifatida emas, balki `Buffer.from(..., 'utf8')` orqali baytlarga o'girgan edi. Natijada Google Authenticator / Authy ilovalari hosil qilgan 6 xonali kod server kodi bilan mos kelmasdi.
   - **Yechim:** RFC 4648 5-bitli Base32 dekodlash algoritmi (`decodeBase32`) to'liq va aniq yozildi.
4. **Soxta QR Kod o'rniga haqiqiy ISO/IEC 18004 QR Kod generatori (`src/utils/qrCode.ts`, `src/components/TelegramShareModal.tsx`)**:
   - **Muammo:** `TelegramShareModal.tsx` ichidagi `buildDeterministicQrMatrix` funksiyasi Reed-Solomon xato tuzatish bitlarisiz tasodifiy kataklar chizgani sababli telefon kameralari uni skanerlay olmasdi.
   - **Yechim:** Galois maydoni $GF(2^8)$ Reed-Solomon xato tuzatish bloklari, Byte mode kodlash, Finder/Alignment/Timing naqshlari va BCH format bitlariga ega haqiqiy skanerlanadigan ISO/IEC 18004 QR kod generatori (`generateQrCodeMatrix`) yaratildi.
5. **Yig'im davrining ochiqlik va yopilish sanalari (`start_date` va `closing_date`) tekshiruvi (`server.ts`, `src/utils/edupayLogic.ts`)**:
   - **Muammo:** `POST /api/public/submissions` faqat `status === 'active'` ni tekshirib, `start_date` va `closing_date` muddat oynasini tekshirmas edi.
   - **Yechim:** `validateCollectionPeriodWindow(activePeriod.start_date, activePeriod.closing_date)` tekshiruvi qo'shildi.
6. **Admin tomonidan yozuvni tahrirlashda takroriy o'quvchi ismini tekshirish (`server.ts`)**:
   - **Muammo:** `PUT /api/admin/submissions/:id` endpointida tahrirlangan ism-familiya shu guruh va davrda boshqa o'quvchi bilan ustma-ust tushishi tekshirilmagan edi.
   - **Yechim:** `id != ?` sharti bilan `normalized_student_name` bo'yicha dublikat tekshiruvi (`409 Conflict`) qo'shildi.
7. **Reverse Proxy ortida IP Rate-Limit va xotira tozalanishi (`server.ts`)**:
   - **Muammo:** `app.set('trust proxy', 1)` yoqilmaganligi sababli barcha foydalanuvchilar bitta IP sifatida ko'rilishi va `Map` xotirasi tozalanmasligi mumkin edi.
   - **Yechim:** `app.set('trust proxy', 1)` va `pruneExpiredRateLimits()` xotira tozalash mexanizmi qo'shildi.
8. **Excel eksportlarini Audit Log'da qayd etish va repo konfiguratsiyasini tozalash (`DashboardOverview.tsx`, `ReportsAndExportView.tsx`, `.gitignore`, `package.json`)**:
   - **Yechim:** Excel yuklab olinganda `/api/admin/export-excel` orqali `EXCEL_YUKLAB_OLINDI` hodisasi `audit_logs` ga yoziladigan qilindi; `.gitignore` ga `data/*.sqlite*` qo'shildi; `package.json` dan ishlatilmayotgan paketlar tozalanib `"test"` skripti qo'shildi.

---

## 2. XAVFSIZLIK TESTLARI NATIJALARI (SECURITY TEST RESULTS: TESTS A–K)

`src/utils/edupayLogic.test.ts` va `src/utils/securityAudit.test.ts` orqali barcha xavfsizlik va mantiqiy testlar tekshirildi:

- **Test A (Unauthenticated Admin Route Access):** Tizimga kirmasdan `/api/admin/*` manzillariga murojaat qilish `401 Unauthorized` qaytaradi — **PASSED**.
- **Test B (Student Code Gate & Student-to-Admin Crossover Block):** O'quvchi kodi (`EDU-2026`)siz `/api/public/context` va `/api/public/submissions` yopiq (`401`); o'quvchi kodi yoki `stu_*` tokeni bilan `/api/admin/*` va `/api/auth/login` ga o'tish qat'iyan `403 Forbidden` bilan bloklanadi — **PASSED**.
- **Test C (Public Student Submission with Student Token):** Tasdiqlangan o'quvchi tokeni bilan to'lov sanasini yuborish `201 Created` qaytaradi va boshqa o'quvchilar ma'lumotini oshkor etmaydi — **PASSED**.
- **Test D–I (Direct Table Query, Tamper, Privilege Escalation, Public Export Blocks):** Barcha ruxsatsiz so'rovlar `401`/`403` bilan rad etiladi — **PASSED**.
- **Test J (Valid Administrator Login with Strong Admin Code, Code Rotation, Duplicate Edit Check, Excel Export, Logout):** Administrator faqat Login + Parol + Kuchaytirilgan Maxfiy Kod bilan kira oladi, kodlarni yangilay oladi, dublikat tahrirlar `409` bilan qaytariladi — **PASSED**.
- **Test K (Idempotent Admin Bootstrap):** Dastlabki administrator hisobi va `admin_code_hash` idempotent tarzda yaratiladi — **PASSED**.
