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
//        /holat yoki "📋 Qurilmalarim" -> o'z qurilmalari holati.
//        talon raqamini yozadi (masalan 1250) -> o'sha qurilma holati; tayyor bo'lsa "Olib ketaman" tugmasi.
// Guruh yoki kanal: /id -> chat ID ni ko'rsatadi (sozlamalarga yozish uchun).

const ST: Record<string, string> = { qabul: '📥 Qabul qilindi', diag: '🔍 Diagnostikada', tamir: "🔧 Ta'mirda", tayyor: '✅ Tayyor', berildi: '📦 Topshirilgan' };
const MENU = { keyboard: [[{ text: '📋 Qurilmalarim' }]], resize_keyboard: true, is_persistent: true };
const ASK_PHONE = { keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };

type Db = ReturnType<typeof admin>;

function readyButtons(talon: number) {
  return { inline_keyboard: [[{ text: '🚗 Olib ketaman', callback_data: `pick:${talon}` }, { text: "📞 Qo'ng'iroq qiling", callback_data: `call:${talon}` }]] };
}

// ===== Rahbar rejimi (Sozlamalar → Telegram → "Botda boshqaruvchilar") =====
const isAdmin = (s: any, id: unknown) => (s.tg?.admins || []).map(String).includes(String(id));
const ST_ORDER = ['qabul', 'diag', 'tamir', 'tayyor', 'berildi'];
function adminButtons(talon: number, status: string) {
  const b = (st: string) => ({ text: (st === status ? '● ' : '') + ST[st], callback_data: `ad:${st}:${talon}` });
  return { inline_keyboard: [[b('qabul'), b('diag')], [b('tamir'), b('tayyor')], [b('berildi'), { text: "💰 Narxni o'zgartirish", callback_data: `ad:fee:${talon}` }]] };
}
function adminCard(r: any) {
  const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 864e5);
  return [
    `№${r.talon} · ${r.device}${r.model ? ' ' + r.model : ''}`,
    `👤 ${r.client_name} · ${r.client_phone}${r.client_phone2 ? ' · ' + r.client_phone2 : ''}`,
    `❗️ ${r.problem}`,
    `Holati: ${ST[r.status] || r.status}`,
    `💰 Narx: ${Number(r.fee_uzs) ? fmt(r.fee_uzs) + " so'm" : 'yozilmagan'}`,
    `📅 Qabul: ${new Date(r.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (${days} kun)`,
  ].join('\n');
}
const REP_COLS = 'talon,created_at,client_name,client_phone,client_phone2,device,model,problem,status,fee_uzs';
async function adminSearch(db: Db, chat: number, text: string) {
  const d = text.replace(/\D/g, '');
  const found = new Map<number, any>();
  if (d.length <= 7) {
    const { data } = await db.from('repairs').select(REP_COLS).eq('talon', Number(d)).maybeSingle();
    if (data) found.set(data.talon, data);
  }
  if (d.length >= 4) {
    const { data } = await db.from('repairs').select(REP_COLS).or(`client_phone.like.*${d},client_phone2.like.*${d}`)
      .order('talon', { ascending: false }).limit(20);
    for (const r of data || []) found.set(r.talon, r);
  }
  const list = [...found.values()].sort((a, b) => (a.status === 'berildi' ? 1 : 0) - (b.status === 'berildi' ? 1 : 0) || b.talon - a.talon);
  if (!list.length) return tg('sendMessage', { chat_id: chat, text: `"${text}" bo'yicha talon topilmadi.` });
  const shown = list.slice(0, 6);
  if (list.length > shown.length) await tg('sendMessage', { chat_id: chat, text: `${list.length} ta topildi, oxirgi ${shown.length} tasi (topshirilmaganlar oldin):` });
  for (const r of shown) await tg('sendMessage', { chat_id: chat, text: adminCard(r), reply_markup: adminButtons(r.talon, r.status) });
}
const feeOf = (text: string) => {
  const raw = text.replace(/[\s,.']/g, '').toLowerCase();
  if (!/\d/.test(raw)) return NaN;
  const k = /(ming|k)$/.test(raw) ? 1000 : 1;
  return Number(raw.replace(/\D/g, '')) * k;
};

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
  // Rahbar rejimi tugmalari: ad:<holat|fee>:<talon>
  if (u.callback_query && String(u.callback_query.data || '').startsWith('ad:')) {
    const cq = u.callback_query, chat = cq.message?.chat?.id, [, act, t] = String(cq.data).split(':'), talon = Number(t);
    try {
      const s = await settings(db);
      if (!isAdmin(s, cq.from?.id)) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, show_alert: true, text: "Sizda bu amalga ruxsat yo'q" });
        return json({ ok: true });
      }
      const { data: r } = await db.from('repairs').select(REP_COLS).eq('talon', talon).maybeSingle();
      if (!r) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Talon topilmadi' });
      } else if (act === 'fee') {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', { chat_id: chat, text: `💰 №${talon} yangi narxini yozing (so'm), masalan: 150000`, reply_markup: { force_reply: true, input_field_placeholder: `№${talon} narxi` } });
      } else if (act === 'tayyor' && !Number(r.fee_uzs) && r.status !== 'tayyor') {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Narxini yozing 👇' });
        await tg('sendMessage', { chat_id: chat, text: `💰 №${talon} ta'mir narxini yozing (so'm), masalan: 150000\nBepul bo'lsa 0 yozing. Narx yozilgach "Tayyor" bo'ladi va mijozga xabar ketadi.`, reply_markup: { force_reply: true, input_field_placeholder: `№${talon} narxi` } });
      } else if (ST_ORDER.includes(act)) {
        if (act !== r.status) {
          const { error } = await db.from('repairs').update({ status: act, ask_msg_id: null, ...(act === 'tayyor' ? { notified_at: null } : {}) }).eq('talon', talon);
          if (error) throw error;
        }
        const nr = { ...r, status: act };
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `№${talon}: ${ST[act]} ✅` });
        await tg('editMessageText', { chat_id: chat, message_id: cq.message.message_id, text: adminCard(nr) + (act === 'tayyor' && r.status !== 'tayyor' ? '\n\n📨 Mijozga 5 daqiqa ichida xabar ketadi' : ''), reply_markup: adminButtons(talon, act) }).catch(() => {});
      } else {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
      }
    } catch (e) {
      console.error(e);
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: "Xatolik, keyinroq urinib ko'ring" }).catch(() => {});
    }
    return json({ ok: true });
  }

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
    } else if (m.reply_to_message?.from?.is_bot && /№(\d+) (ta'mir|yangi) narxini yozing/.test(m.reply_to_message.text || '')) {
      // Narx javobi: guruhda (Tayyor uchun) yoki rahbar shaxsiy chatda
      const s = await settings(db);
      const okChat = m.chat.type === 'private' ? isAdmin(s, m.from?.id) : String(chat) === String(s.tg?.group);
      if (okChat) {
        const q = m.reply_to_message.text, talon = Number((q.match(/№(\d+)/) || [])[1]), makeReady = q.includes("ta'mir narxini");
        const fee = feeOf(text);
        const { data: r } = await db.from('repairs').select(REP_COLS).eq('talon', talon).maybeSingle();
        const who = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || 'xodim';
        if (!r) {
          await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: `№${talon} talon topilmadi.` });
        } else if (!Number.isFinite(fee)) {
          await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: "Narxni raqam bilan yozing, masalan: 150000. So'rov xabariga javob qilib qayta yozing." });
        } else if (makeReady && ['tayyor', 'berildi'].includes(r.status)) {
          await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: `№${talon} allaqachon: ${ST[r.status]}` });
        } else {
          const { error } = await db.from('repairs').update({ fee_uzs: fee, ...(makeReady ? { status: 'tayyor', notified_at: null, ask_msg_id: null } : {}) }).eq('talon', talon);
          if (error) throw error;
          const nr = { ...r, fee_uzs: fee, status: makeReady ? 'tayyor' : r.status };
          if (m.chat.type === 'private') {
            await tg('sendMessage', { chat_id: chat, text: adminCard(nr) + (makeReady ? '\n\n📨 Mijozga 5 daqiqa ichida xabar ketadi' : "\n\n✅ Narx saqlandi"), reply_markup: adminButtons(talon, nr.status) });
          } else {
            await tg('sendMessage', { chat_id: chat, reply_to_message_id: m.message_id, text: `✅ №${talon} tayyor · ${fmt(fee)} so'm (${who}). Mijozga 5 daqiqa ichida xabar ketadi.` });
          }
        }
      }
    } else if (m.chat.type !== 'private') {
      // guruhlarda boshqa buyruqlarga javob bermaymiz
    } else if (m.chat.type === 'private' && /^(\/start|\/admin)$/.test(text) && isAdmin(await settings(db), m.from?.id)) {
      await tg('sendMessage', { chat_id: chat, reply_markup: { remove_keyboard: true }, text: "👑 Rahbar rejimi\n\nTalon raqamini (masalan 1250) yoki mijoz telefonining oxirgi 4+ raqamini (masalan 4567) yozing — talon chiqadi, holatini va narxini shu yerdan o'zgartirasiz." });
    } else if (m.chat.type === 'private' && /^[\d\s+()№#-]{1,20}$/.test(text) && /\d/.test(text) && isAdmin(await settings(db), m.from?.id)) {
      await adminSearch(db, chat, text);
    } else if (m.chat.type === 'private' && /^\/start\s+t\d{1,7}$/i.test(text)) {
      // Talondagi QR koddan kelgan mijoz: holatini ko'rsatamiz, raqam ulanmagan bo'lsa ulashni taklif qilamiz
      const talon = Number(text.replace(/\D/g, ''));
      const r = await talonInfo(db, chat, talon);
      const { data: cl } = await db.from('clients').select('phone').eq('tg_chat_id', chat).limit(1);
      await tg('sendMessage', { chat_id: chat, text: r.text, ...(r.reply_markup ? { reply_markup: r.reply_markup } : {}) });
      if (!cl?.length) {
        await tg('sendMessage', { chat_id: chat, reply_markup: ASK_PHONE, text: "Qurilmangiz tayyor bo'lganda shu yerga xabar kelishi va narxini ko'rish uchun telefon raqamingizni yuboring 👇 (talondagi raqam bilan bir xil bo'lsin)" });
      } else {
        await tg('sendMessage', { chat_id: chat, reply_markup: MENU, text: "Qurilmangiz tayyor bo'lganda shu yerga xabar keladi ✅" });
      }
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
