// Telegram bot webhook.
// Mijoz: /start -> raqamini yuboradi -> qurilmasi tayyor bo'lganda shu chatga xabar keladi.
//        /holat -> o'z qurilmalari holati.
// Guruh yoki kanal: /id -> chat ID ni ko'rsatadi (sozlamalarga yozish uchun).
import { admin, fmt, json, phoneKey, tg } from '../_shared/common.ts';

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
