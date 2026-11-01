// tg-bot

// Umumiy yordamchilar: Telegram, Supabase (service), vaqt, formatlash
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const env = (k: string, def = '') => Deno.env.get(k) ?? def;

/** Server kaliti: eski (SERVICE_ROLE) yoki yangi (SECRET_KEYS) ko'rinishda bo'lishi mumkin */
function serviceKey() {
  const k = env('SUPABASE_SERVICE_ROLE_KEY');
  if (k) return k;
  try { const j = JSON.parse(env('SUPABASE_SECRET_KEYS', '{}')); return j.default || Object.values(j)[0] || ''; } catch { return ''; }
}
export const admin = () =>
  createClient(env('SUPABASE_URL'), serviceKey(), { auth: { persistSession: false } });

export const fmt = (n: unknown) =>
  String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Toshkent vaqti: { day: '2026-11-01', hm: '21:05' } */
export function tashkentNow(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a: Record<string, string>, x) => (a[x.type] = x.value, a), {});
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
export const dmy = (day: string) => day.split('-').reverse().join('.');

const TG = () => `https://api.telegram.org/bot${env('TG_BOT_TOKEN')}`;

export async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

export async function tgForm(method: string, form: FormData) {
  const r = await fetch(`${TG()}/${method}`, { method: 'POST', body: form });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

/** Telefonni solishtirish uchun: oxirgi 9 raqam (998 kodsiz) */
export const phoneKey = (p: string) => String(p || '').replace(/\D/g, '').slice(-9);

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const CATS: Record<string, string> = {
  qism: 'Ehtiyot qism', transport: 'Transport', ovqat: 'Ovqat', kommunal: 'Kommunal / internet',
  ijara: 'Ijara', oylik: 'Oylik / avans', boshqa: 'Boshqa',
};
export const PAYS: Record<string, string> = { naqd: 'Naqd', karta: 'Karta', otkazma: "O'tkazma" };

// Telegram bot webhook.
// Mijoz: /start -> raqamini yuboradi -> qurilmasi tayyor bo'lganda shu chatga xabar keladi.
//        /holat -> o'z qurilmalari holati.
// Guruh yoki kanal: /id -> chat ID ni ko'rsatadi (sozlamalarga yozish uchun).

const ST: Record<string, string> = { qabul: 'Qabul qilindi', diag: 'Diagnostikada', tamir: "Ta'mirda", tayyor: '✅ Tayyor', berildi: 'Topshirilgan' };

Deno.serve(async (req) => {
  const db = admin();
  const { data: okSecret } = await db.rpc('secret_ok', { p_name: 'tg_webhook_secret', p_val: req.headers.get('x-telegram-bot-api-secret-token') || '' });
  if (!okSecret) return json({ error: 'forbidden' }, 403);
  const u = await req.json();
  const m = u.message || u.channel_post;
  if (!m) return json({ ok: true });
  const chat = m.chat.id, text: string = m.text || '';

  try {
    if (text.startsWith('/id')) {
      await tg('sendMessage', { chat_id: chat, text: `Bu chat ID: ${chat}\nUni dasturdagi Sozlamalar → Telegram bo'limiga yozing.` });
    } else if (m.chat.type !== 'private') {
      // guruhlarda boshqa buyruqlarga javob bermaymiz
    } else if (m.contact) {
      if (m.contact.user_id && m.contact.user_id !== m.from?.id) {
        await tg('sendMessage', { chat_id: chat, text: "Iltimos, o'zingizning raqamingizni tugma orqali yuboring." });
      } else {
        const key = phoneKey(m.contact.phone_number);
        const { data: list } = await db.from('clients').select('phone,name');
        const mine = (list || []).filter((c) => phoneKey(c.phone) === key);
        for (const c of mine) await db.from('clients').update({ tg_chat_id: chat }).eq('phone', c.phone);
        await tg('sendMessage', {
          chat_id: chat, reply_markup: { remove_keyboard: true },
          text: mine.length
            ? `Rahmat, ${mine[0].name}! Raqamingiz ulandi. Qurilmangiz tayyor bo'lganda shu yerga xabar keladi.\nHolatni ko'rish: /holat`
            : "Raqamingiz bazamizda topilmadi. Qurilmani topshirganda aytgan raqamingizdan yuboring yoki servisga murojaat qiling.",
        });
      }
    } else if (text.startsWith('/holat')) {
      const { data: cl } = await db.from('clients').select('phone').eq('tg_chat_id', chat);
      const phones = (cl || []).map((c) => c.phone);
      const { data: rs } = phones.length
        ? await db.from('repairs').select('talon,device,model,status,fee_uzs').in('client_phone', phones).neq('status', 'berildi').order('talon')
        : { data: [] };
      await tg('sendMessage', {
        chat_id: chat,
        text: !phones.length ? "Avval /start bosib raqamingizni ulang."
          : rs?.length ? rs.map((r) => `№${r.talon} · ${r.device}${r.model ? ' ' + r.model : ''}\n${ST[r.status]}${Number(r.fee_uzs) ? ` · ${fmt(r.fee_uzs)} so'm` : ''}`).join('\n\n')
          : "Hozir servisda qurilmangiz yo'q.",
      });
    } else {
      await tg('sendMessage', {
        chat_id: chat,
        text: "Assalomu alaykum! Qurilmangiz tayyor bo'lganda xabar olish uchun telefon raqamingizni yuboring.",
        reply_markup: { keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
    }
  } catch (e) {
    console.error(e);
  }
  return json({ ok: true });
});
