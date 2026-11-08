// Telegram bot webhook.
// Mijoz: /start -> raqamini yuboradi -> qurilmasi tayyor bo'lganda shu chatga xabar keladi.
//        /holat yoki "📋 Qurilmalarim" -> o'z qurilmalari holati.
//        talon raqamini yozadi (masalan 1250) -> o'sha qurilma holati; tayyor bo'lsa "Olib ketaman" tugmasi.
// Guruh yoki kanal: /id -> chat ID ni ko'rsatadi (sozlamalarga yozish uchun).
import { admin, fmt, json, tg } from '../_shared/common.ts';

const ST: Record<string, string> = { qabul: '📥 Qabul qilindi', diag: '🔍 Diagnostikada', tamir: "🔧 Ta'mirda", tayyor: '✅ Tayyor', berildi: '📦 Topshirilgan' };
const MENU = { keyboard: [[{ text: '📋 Qurilmalarim' }]], resize_keyboard: true, is_persistent: true };
const ASK_PHONE = { keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };

type Db = ReturnType<typeof admin>;

function readyButtons(talon: number) {
  return { inline_keyboard: [[{ text: '🚗 Olib ketaman', callback_data: `pick:${talon}` }, { text: "📞 Qo'ng'iroq qiling", callback_data: `call:${talon}` }]] };
}

async function settings(db: Db) {
  const { data } = await db.from('settings').select('company,tg').eq('id', 1).single();
  return data || { company: {}, tg: {} };
}

async function talonInfo(db: Db, chat: number, talon: number) {
  const { data: r, error } = await db.rpc('bot_talon', { p_chat: chat, p_talon: talon });
  if (error) throw error;
  if (!r?.found) return { text: `№${talon} talon topilmadi. Raqamni tekshirib qayta yozing.` };
  if (!r.mine) {
    return {
      text: `№${r.talon} · ${r.device}\nHolati: ${ST[r.status] || r.status}\n\nNarxi va batafsil ma'lumot faqat talondagi telefon raqam egasiga ko'rinadi. Raqamingizni ulash uchun /start bosing.`,
    };
  }
  const lines = [`№${r.talon} · ${r.device}${r.model ? ' ' + r.model : ''}`, `Holati: ${ST[r.status] || r.status}`];
  if (Number(r.fee)) lines.push(`Narxi: ${fmt(r.fee)} so'm`);
  if (r.status === 'tayyor') lines.push(r.pickup ? "\nSiz olib ketishingizni aytgansiz — kutib turibmiz 🙂" : "\nQurilmangiz tayyor! Olib ketish vaqtini bildiring:");
  return { text: lines.join('\n'), reply_markup: r.status === 'tayyor' && !r.pickup ? readyButtons(r.talon) : undefined };
}

Deno.serve(async (req) => {
  const db = admin();
  const { data: okSecret } = await db.rpc('secret_ok', { p_name: 'tg_webhook_secret', p_val: req.headers.get('x-telegram-bot-api-secret-token') || '' });
  if (!okSecret) return json({ error: 'forbidden' }, 403);
  const u = await req.json();

  // Tugma bosildi: "Olib ketaman" / "Qo'ng'iroq qiling"
  // Guruhdagi ustaxona so'rovi tugmalari: dq:<diag|tamir|tayyor|snooze>:<talon>
  if (u.callback_query && String(u.callback_query.data || '').startsWith('dq:')) {
    const cq = u.callback_query, chat = cq.message?.chat?.id, [, act, t] = String(cq.data).split(':'), talon = Number(t);
    try {
      const s = await settings(db);
      if (String(chat) !== String(s.tg?.group)) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Bu tugma faqat ishchi guruhda ishlaydi' });
        return json({ ok: true });
      }
      const { data: r } = await db.from('repairs').select('talon,status,fee_uzs,device,model').eq('talon', talon).maybeSingle();
      const who = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(' ') || cq.from?.username || 'xodim';
      const now = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
      const done = async (line: string) => {
        await tg('editMessageText', { chat_id: chat, message_id: cq.message.message_id, text: `${cq.message.text}\n\n${line}` }).catch(() => {});
      };
      if (!r) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Talon topilmadi' });
      } else if (!['qabul', 'diag'].includes(r.status)) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `Holati allaqachon: ${ST[r.status] || r.status}` });
        await done(`ℹ️ Holati dasturda o'zgartirilgan: ${ST[r.status] || r.status}`);
      } else if (act === 'snooze') {
        await db.from('repairs').update({ ask_next_at: new Date(Date.now() + 60 * 60000).toISOString(), ask_count: 0, ask_msg_id: null }).eq('talon', talon);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: "1 soatdan keyin yana so'rayman" });
        await done(`⏳ ${who} (${now}): 1 soatdan keyin so'raladi`);
      } else if (act === 'tayyor' && !Number(r.fee_uzs)) {
        // Narx yozilmagan: guruhda narxni so'raymiz (shu xabarga javob qilib yoziladi)
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Narxini yozing 👇' });
        await tg('sendMessage', {
          chat_id: chat, reply_to_message_id: cq.message.message_id,
          text: `💰 №${talon} ta'mir narxini yozing (so'm), masalan: 150000\nBepul bo'lsa 0 yozing. Narx yozilgach "Tayyor" bo'ladi va mijozga xabar ketadi.`,
          reply_markup: { force_reply: true, selective: false, input_field_placeholder: `№${talon} narxi, so'm` },
        });
      } else if (['diag', 'tamir', 'tayyor'].includes(act)) {
        await db.from('repairs').update({ status: act, ask_msg_id: null, ...(act === 'tayyor' ? { notified_at: null } : {}) }).eq('talon', talon);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `№${talon}: ${ST[act]} ✅` });
        await done(`✅ ${who} (${now}): ${ST[act]}${act === 'tayyor' ? ' — mijozga xabar ketadi' : ''}`);
      } else {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
      }
    } catch (e) {
      console.error(e);
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: "Xatolik, keyinroq urinib ko'ring" }).catch(() => {});
    }
    return json({ ok: true });
  }

  if (u.callback_query) {
    const cq = u.callback_query, chat = cq.message?.chat?.id, [kind, t] = String(cq.data || '').split(':');
    try {
      const { data: r, error } = await db.rpc('bot_pickup', { p_chat: chat, p_talon: Number(t), p_kind: kind === 'call' ? 'call' : 'pickup' });
      if (error) throw error;
      const s = await settings(db);
      const phone = s.company?.lines?.servis?.phone || '';
      if (!r?.ok) {
        await tg('answerCallbackQuery', {
          callback_query_id: cq.id, show_alert: true,
          text: r?.why === 'not_ready' ? "Qurilma hali tayyor emas. Tayyor bo'lganda xabar keladi." : "Bu talon sizning raqamingizga tegishli emas.",
        });
      } else {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Qabul qilindi ✅' });
        await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        await tg('sendMessage', {
          chat_id: chat,
          text: kind === 'call'
            ? `Rahmat! Ustalarimiz tez orada sizga qo'ng'iroq qilishadi.${phone ? `\nO'zingiz ham qo'ng'iroq qilishingiz mumkin: ${phone}` : ''}`
            : `Rahmat, ${r.name}! Kutib qolamiz 🙂 Kelganingizda №${r.talon} talonni ko'rsating.${Number(r.fee) ? `\nTo'lov: ${fmt(r.fee)} so'm` : ''}${phone ? `\nTel: ${phone}` : ''}`,
        });
        if (s.tg?.group) {
          await tg('sendMessage', {
            chat_id: s.tg.group,
            text: kind === 'call'
              ? `📞 №${r.talon} · ${r.name} (${r.phone}) qo'ng'iroq qilishni so'radi\n${r.device}${r.model ? ' ' + r.model : ''}`
              : `🚗 №${r.talon} · ${r.name} (${r.phone}) qurilmasini olib ketishga kelyapti\n${r.device}${r.model ? ' ' + r.model : ''}${Number(r.fee) ? ` · ${fmt(r.fee)} so'm` : ''}`,
          }).catch((e) => console.error(e));
        }
      }
    } catch (e) {
      console.error(e);
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Xatolik, keyinroq urinib ko\'ring' }).catch(() => {});
    }
    return json({ ok: true });
  }

  const m = u.message || u.channel_post;
  if (!m) return json({ ok: true });
  const chat = m.chat.id, text: string = (m.text || '').trim();

  try {
    if (text.startsWith('/id')) {
      await tg('sendMessage', { chat_id: chat, text: `Bu chat ID: ${chat}\nUni dasturdagi Sozlamalar → Telegram bo'limiga yozing.` });
    } else if (m.chat.type !== 'private' && m.reply_to_message?.from?.is_bot && /№(\d+) ta'mir narxini yozing/.test(m.reply_to_message.text || '')) {
      // Guruhda "Tayyor" uchun narx javobi
      const s = await settings(db);
      if (String(chat) === String(s.tg?.group)) {
        const talon = Number((m.reply_to_message.text.match(/№(\d+)/) || [])[1]);
        const raw = text.replace(/[\s,.']/g, '').toLowerCase();
        const k = /(ming|k)$/.test(raw) ? 1000 : 1;
        const fee = Number(raw.replace(/(ming|k|so'?m|sum)$/g, '').replace(/\D/g, '')) * k;
        const { data: r } = await db.from('repairs').select('talon,status').eq('talon', talon).maybeSingle();
        const who = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || 'xodim';
        if (!r) {
          await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: `№${talon} talon topilmadi.` });
        } else if (['tayyor', 'berildi'].includes(r.status)) {
          await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: `№${talon} allaqachon: ${ST[r.status]}` });
        } else if (!/\d/.test(text) || !Number.isFinite(fee)) {
          await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: `Narxni raqam bilan yozing, masalan: 150000. Iltimos, yuqoridagi so'rovga javob qilib qayta yozing.` });
        } else {
          await db.from('repairs').update({ fee_uzs: fee, status: 'tayyor', notified_at: null, ask_msg_id: null }).eq('talon', talon);
          await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: `✅ №${talon} tayyor · ${fmt(fee)} so'm (${who}). Mijozga 5 daqiqa ichida xabar ketadi.` });
        }
      }
    } else if (m.chat.type !== 'private') {
      // guruhlarda boshqa buyruqlarga javob bermaymiz
    } else if (m.contact) {
      if (m.contact.user_id && m.contact.user_id !== m.from?.id) {
        await tg('sendMessage', { chat_id: chat, text: "Iltimos, o'zingizning raqamingizni tugma orqali yuboring." });
      } else {
        const nm = [m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ');
        const { data: r, error } = await db.rpc('tg_link', { p_phone: m.contact.phone_number, p_chat: chat, p_name: nm });
        if (error) throw error;
        await tg('sendMessage', {
          chat_id: chat, reply_markup: MENU,
          text: r?.found
            ? `Rahmat, ${r.name}! Raqamingiz ulandi ✅ Qurilmangiz tayyor bo'lganda shu yerga xabar keladi.\n\nHolatni ko'rish: "📋 Qurilmalarim" tugmasi yoki talon raqamini yozing (masalan: 1250).`
            : `Rahmat${nm ? ', ' + nm : ''}! Raqamingiz ro'yxatga olindi ✅ Servisga qurilma topshirganingizda holati shu yerga keladi.\n\nTalon raqamini yozsangiz, holatini ko'rsataman.`,
        });
      }
    } else if (/^\/?(talon\s*)?№?\s*\d{1,7}$/i.test(text)) {
      const talon = Number(text.replace(/\D/g, ''));
      const r = await talonInfo(db, chat, talon);
      await tg('sendMessage', { chat_id: chat, text: r.text, ...(r.reply_markup ? { reply_markup: r.reply_markup } : {}) });
    } else if (text.startsWith('/holat') || text === '📋 Qurilmalarim') {
      const { data: cl } = await db.from('clients').select('phone').eq('tg_chat_id', chat);
      const phones = (cl || []).map((c) => c.phone);
      if (!phones.length) {
        await tg('sendMessage', { chat_id: chat, text: 'Avval telefon raqamingizni ulang 👇', reply_markup: ASK_PHONE });
      } else {
        const { data: rs } = await db.from('repairs').select('talon,device,model,status,fee_uzs,pickup_at')
          .or(`client_phone.in.(${phones.map((p) => `"${p}"`).join(',')}),client_phone2.in.(${phones.map((p) => `"${p}"`).join(',')})`)
          .neq('status', 'berildi').order('talon');
        if (!rs?.length) {
          await tg('sendMessage', { chat_id: chat, text: "Hozir servisda qurilmangiz yo'q.", reply_markup: MENU });
        } else {
          for (const r of rs.slice(0, 10)) {
            const ready = r.status === 'tayyor' && !r.pickup_at;
            await tg('sendMessage', {
              chat_id: chat,
              text: `№${r.talon} · ${r.device}${r.model ? ' ' + r.model : ''}\n${ST[r.status] || r.status}${Number(r.fee_uzs) ? ` · ${fmt(r.fee_uzs)} so'm` : ''}`,
              ...(ready ? { reply_markup: readyButtons(r.talon) } : {}),
            });
          }
        }
      }
    } else {
      const { data: cl } = await db.from('clients').select('phone').eq('tg_chat_id', chat).limit(1);
      await tg('sendMessage', cl?.length
        ? { chat_id: chat, reply_markup: MENU, text: 'Talon raqamini yozing (masalan: 1250) yoki "📋 Qurilmalarim" tugmasini bosing.' }
        : {
          chat_id: chat, reply_markup: ASK_PHONE,
          text: "Assalomu alaykum! Qurilmangiz tayyor bo'lganda xabar olish va holatini ko'rish uchun telefon raqamingizni yuboring.\n\nTalon raqamini yozsangiz ham holatini ko'rsataman.",
        });
    }
  } catch (e) {
    console.error(e);
  }
  return json({ ok: true });
});
