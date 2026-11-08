# COMPMIR dasturi — loyiha pasporti

> Bu fayl faqat **COMPMIR** dasturi haqida. Boshqa loyihalar (COM-TECH qurilmalari, Mecanuz avtomati va h.k.) bu yerga **qo'shilmaydi**.
> Yangi chatda shu faylni yuborsangiz, Claude loyihani boshidan tushunib davom ettiradi.

## Firma
- **COMPMIR** — kompyuter ta'mirlash ustaxonasi va savdo ofisi. Tel: **97-210-05-15**
- Yo'nalishlar:
  - **Servis (COMPMIR)** — Telegram/Instagram: @compmir
  - **NOUTBUK SAVDOSI** — Telegram @noutbuk_savdo, Instagram @noutbuk.savdo
  - **KOMPYUTER.UZ** (korpus, gaming, qismlar) — Telegram @kompyuterxon, Instagram @kompyuter.uz
- Printerlar: **WP230** (chek, talon), **Xprinter XP-365B** (etiketka, yopishtirgich)

## Dastur manzillari
- Ishlaydigan sayt (doim oxirgi versiya): https://compmiruz-web.github.io/comtech-servis/
- GitHub: https://github.com/compmiruz-web/comtech-servis (manba kod: `manba/` papkasida)
- Baza: Supabase, loyiha `ufdvanyjmfyjrdhrnalz` (comtech-servis)
- Telegram: hisobot guruhi `-4993928009`, zaxira baza guruhi `-5453553679`; bot tokeni Supabase sirlarida (`TG_BOT_TOKEN`)

## Tuzilishi
- Ilova: Vite + oddiy JavaScript (`manba/app/src/main.js`), PWA — Android, iOS, kompyuterda ishlaydi
- Baza o'zgarishlari: `manba/supabase/migrations/0001 … 0021` (0021 — ustaxona nazorati)
- Server funksiyalari (Supabase Edge): `tick` (har 5 daqiqada), `tg-bot` (Telegram bot), `admin-users`
  - Dashboard uchun bitta faylli nusxalar: `manba/deploy/tick.ts`, `manba/deploy/tg-bot.ts`
  - "Verify JWT" o'chiq turishi shart
- Vaqt: hamma joyda Toshkent vaqti (kompyuter soati noto'g'ri bo'lsa ham server soati bilan to'g'rilanadi)

## Imkoniyatlar (hozir ishlaydi)
- **Lavozimlar:** rahbar, usta, sotuvchi, usta va sotuvchi; har xodimga alohida ruxsatlar (kirim, rasxod, oylik ko'rish, qarz, vazvrat, nasiya, narx tushirish)
- **Ombor:** dollarda kelish, so'mda yoki dollarda sotish, kunlik kurs, shtrix-kod (USB skaner va telefon kamerasi), bo'limlar (qo'lda yangi bo'lim yaratish), kirim vaqti, rahbar barcha narx va sonlarni tahrirlaydi
- **Sotuv:** savat, chek, oldingi kun sotuvi, vazvrat, nasiya, narx tushirish chegarasi (%, so'm yoki $)
- **Ustaxona:** talon (raqam daftardan davom etadi), qo'shimcha va eski raqam, holatlar, "Tayyor"da mijozga Telegram/SMS
- **Rasxodlar, oylik va KPI**, oylik berish tarixi, tovar qarzlari (qarzga olingan tovar darhol omborga kiradi)
- **Hisobot** va **bildirishnomalar:** kunlik / oylik foyda yoki zarar
- **Telegram:** 21:00 kunlik hisobot (rasm + matn + Excel), 00:00 baza zaxirasi (JSON + Excel)
- **Etiketka va yopishtirgich:** kafolat muddati, to'liq parametrlar, narx (ixtiyoriy)
- **Mavzu ranglari**, "yangisi tepada" tartibi, jonli soat

### 2026-11-08 da qo'shilgan
1. **Mijozlar boti:** talon raqamini yozsa holati chiqadi (narxni faqat raqam egasi ko'radi); tayyor bo'lganda "🚗 Olib ketaman" / "📞 Qo'ng'iroq qiling" tugmalari → guruhga va rahbarga xabar, Ustaxonada belgi
2. **Kam qolgan tovar:** chegaradan kam qolsa guruhga "buyurtma qilish kerak" (kompyuter qismlari: 2 dona; noutbuklar: o'chiq; har tovarga alohida — Ombor → 📷)
3. **Tahlil** bo'limi: eng ko'p sotilgan / eng foydali tovarlar, bo'limlar, sotuvchilar, ustalar, grafik; dushanba 09:00 haftalik, oyning 1-kuni 09:00 oylik tahlil guruhga
4. **Kafolat** bo'limi: shtrix-kod yoki seriya bo'yicha — kimga, qachon sotilgan, kafolat amalda / tugagan
5. **Telegram kanallarga joylash:** yangi tovar rasm, narx, kafolat bilan (Sozlamalar → Avtomatik xabarlar va kanallar; bot kanalga admin bo'lishi kerak; hozircha o'chiq)

### 2026-11-08 (2) — Ustaxona nazorati
- Guruhga so'rov: "Qabul qilindi"dagi har talon bo'yicha "🔍 Diagnostika qildingizmi?" (tugmalar: Diagnostika qilinyapti / Ta'mirga o'tdi / ✅ Tayyor / 1 soatdan keyin so'ra). "Tayyor"da narx yozilmagan bo'lsa bot guruhda narxni so'raydi — xabarga javob qilib yoziladi (150000, 150 ming), keyin mijozga xabar ketadi. Javob bo'lmasa **har 30 daqiqada** qayta (eski xabar o'chib, yangisi pastga tushadi, "N-marta so'ralyapti" yoziladi)
- "Diagnostikada" 2 soatdan oshsa: "Natijasi qanday?" (Ta'mirga o'tdi / Tayyor)
- Alohida so'rov faqat oxirgi 7 kunda qabul qilingan talonlarga; eskilari (holati yangilanmagan) kuniga bir marta bitta umumiy xabarda
- Faqat ish vaqtida (odatiy 09:00–20:00), Sozlamalar → Avtomatik xabarlar va kanallar'da yoqish/o'chirish va vaqt
- Dasturda Ustaxona ro'yxati muddatga qarab rangda: 1 kun sariq, 3 kun to'q sariq, 5 kun qizil, 8+ kun qizil miltillaydi; tepada "⚠️ Ustaxona nazorati" paneli

## Kelishuvlar
- Javoblar o'zbek tilida
- Foydani faqat rahbar ko'radi
- Parol, token, kalitlarni Claude o'zi kiritmaydi — rahbar o'zi kiritadi
- Bu dastur **faqat COMPMIR** uchun: boshqa loyihalar (avtomatlar va h.k.) qo'shilmaydi

## Keyingi g'oyalar (hali qilinmagan)
- Mijozga Telegram orqali chek / kafolat taloni yuborish
- Yetkazib beruvchilar bo'yicha buyurtma ro'yxati (kam qolganlardan avtomatik)
