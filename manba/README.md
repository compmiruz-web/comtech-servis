# COM-TECH Servis — o'rnatish

Ilova uch qismdan iborat:

| Papka | Nima |
|---|---|
| `ilova/` | Tayyor ilova (PWA). Telefon va kompyuterda brauzer orqali ochiladi, "Bosh ekranga qo'shish" bilan ilova bo'ladi |
| `supabase/migrations/` | Baza (jadvallar, ruxsatlar, sotuv/talon funksiyalari) |
| `supabase/dashboard/` | Server funksiyalari, Supabase saytiga nusxalab joylash uchun |
| `app/` | Ilovaning manba kodi (o'zgartirish uchun) |

## 1. Baza (Supabase)
1. supabase.com → **New project**. Region: **Central EU (Frankfurt)**. Parolni saqlab qo'ying.
2. **SQL Editor** → `supabase/migrations/0001_schema.sql` faylini to'liq joylang → **Run**.
3. **Authentication → Users → Add user**: email `rahbar@comtech.app`, o'zingiz o'ylagan parol, "Auto confirm" yoqilgan.
4. **Authentication → Sign In / Providers**: "Allow new users to sign up" ni **o'chiring** (xodimlarni faqat rahbar qo'shadi).
5. **Project Settings → API**: `Project URL` va `anon public` kalitni oling.

## 2. Telegram bot
1. Telegram'da **@BotFather** → `/newbot` → nom bering → **token**ni oling.
2. Botni hisobot **guruhiga** qo'shing, zaxira **kanaliga admin** qilib qo'shing.

## 3. Server funksiyalari
1. **Edge Functions → Secrets** ga qo'shing:
   - `TG_BOT_TOKEN` — bot tokeni
   - `TG_WEBHOOK_SECRET` — o'zingiz o'ylagan uzun so'z (harf va raqam)
   - `CRON_SECRET` — yana bitta uzun so'z
   - (ixtiyoriy, SMS uchun) `ESKIZ_EMAIL`, `ESKIZ_PASSWORD`, `ESKIZ_FROM`
2. **Edge Functions → Deploy new function → Via editor**, uchta funksiya yarating. Nomi va kodi:
   - `tick` ← `supabase/dashboard/tick.ts` (**Verify JWT: o'chiq**)
   - `tg-bot` ← `supabase/dashboard/tg-bot.ts` (**Verify JWT: o'chiq**)
   - `admin-users` ← `supabase/dashboard/admin-users.ts` (Verify JWT: yoqiq)
3. **SQL Editor** → `supabase/migrations/0002_cron.sql`: `<PROJECT_REF>` va `<CRON_SECRET>` ni almashtirib → **Run**.
4. Brauzerda bir marta oching (TOKEN, REF va SECRET o'rniga o'zingiznikini yozing):
   `https://api.telegram.org/botTOKEN/setWebhook?url=https://REF.supabase.co/functions/v1/tg-bot&secret_token=SECRET`
5. Guruhda va kanalda `/id` yozing. Bot chiqargan ID'larni ilovada **Sozlamalar → Telegram** ga yozing.

## 4. Ilovani joylash
1. **app.netlify.com/drop** ga `ilova/` papkasini sudrab tashlang (yoki Cloudflare Pages / GitHub Pages).
2. Chiqqan manzilni telefonda oching → brauzer menyusi → **Bosh ekranga qo'shish**.
3. Birinchi ochilganda `Project URL` va `anon` kalitni kiriting.
4. Login: `rahbar`, parol: 3-qadamdagi parol. Birinchi kirgan hisob avtomatik rahbar bo'ladi.

## 5. Ish boshlash
- **Sozlamalar**: dollar kursi, keyingi talon raqami (daftardagi oxirgi raqam + 1), printer o'lchamlari.
- **Xodimlar**: har bir xodimga login va 6 raqamli PIN bering.
- **Mijozlar**: daftardagi mijozlarni "telefon; ism" ko'rinishida joylang.
- **Ombor → Kirim**: tovarlarni skaner bilan kiriting.

## Chop etish
Talon, chek, etiketka va stiker oynalarida **Chop etish** tugmasi bor. Kompyuterda printer drayveri (WP230, XP-365B) o'rnatilgan bo'lsin. Chop etish oynasida printerni tanlang, "Margins: None" qiling va masshtabni 100% qoldiring. Qog'oz o'lchami ilovadagi sozlamadan avtomatik olinadi.

## Avtomatik ishlar (har 5 daqiqada tekshiriladi)
- **21:00** — guruhga kunlik hisobot (rasm va matn)
- **00:00** — kanalga butun baza fayli
- Qurilma **"Tayyor"** bo'lganda — mijozga Telegram (agar botga raqamini ulagan bo'lsa) va SMS (Eskiz sozlangan bo'lsa)
