// tick

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

// Har 5 daqiqada pg_cron chaqiradi.
// 1) reportTime bo'lganda guruhga kunlik hisobot (rasm + matn)
// 2) backupTime bo'lganda kanalga butun baza (JSON fayl)
// 3) "Tayyor" bo'lgan qurilmalar egalariga Telegram/SMS xabar

type Db = ReturnType<typeof admin>;

Deno.serve(async (req) => {
  const db = admin();
  const { data: okSecret } = await db.rpc('secret_ok', { p_name: 'cron_secret', p_val: req.headers.get('x-cron-secret') || '' });
  if (!okSecret) return json({ error: 'forbidden' }, 403);
  const force = new URL(req.url).searchParams.get('force'); // ?force=report | backup (qo'lda sinash)
  const { day, hm } = tashkentNow();
  const { data: s, error } = await db.from('settings').select('*').eq('id', 1).single();
  if (error) return json({ error: error.message }, 500);
  const done: string[] = [];

  try {
    // Bot tokeni qo'shilgach, webhook o'zi ulanadi
    if (env('TG_BOT_TOKEN') && !s.webhook_ok) {
      const { data: secret } = await db.rpc('webhook_secret');
      await tg('setWebhook', { url: `${env('SUPABASE_URL')}/functions/v1/tg-bot`, secret_token: secret, allowed_updates: ['message', 'channel_post'] });
      await db.from('settings').update({ webhook_ok: true }).eq('id', 1);
      done.push('webhook');
    }
    if (!env('TG_BOT_TOKEN')) return json({ ok: true, day, hm, note: 'TG_BOT_TOKEN hali qo\'shilmagan' });
    if (force === 'report' || (hm >= (s.tg.reportTime || '21:00') && s.last_report !== day)) {
      await sendReport(db, s, day);
      if (force !== 'report') await db.from('settings').update({ last_report: day }).eq('id', 1);
      done.push('report');
    }
    if (force === 'backup' || (hm >= (s.tg.backupTime || '00:00') && s.last_backup !== day)) {
      await sendBackup(db, s, day);
      if (force !== 'backup') await db.from('settings').update({ last_backup: day }).eq('id', 1);
      done.push('backup');
    }
    done.push(`notified:${await notifyReady(db, s)}`);
  } catch (e) {
    return json({ error: String(e), done }, 500);
  }
  return json({ ok: true, day, hm, done });
});

async function sendReport(db: Db, s: any, day: string) {
  const { data: d, error } = await db.rpc('day_summary', { p_day: day });
  if (error) throw error;
  const name = s.company?.name || 'COM-TECH';
  const lines = [
    `📊 ${name} · ${dmy(day)} kunlik hisobot`, '',
    `🛒 Sotuv: ${d.sales_count} ta · ${fmt(d.revenue)} so'm`,
    ...Object.entries(d.by_pay || {}).map(([k, v]) => `    ${PAYS[k] || k}: ${fmt(v)}`),
    `🔧 Remont: qabul ${d.repairs_in} ta · topshirildi ${d.repairs_done} ta · ${fmt(d.repair_income)} so'm`,
    `💸 Rasxod: ${d.exp_count} ta · ${fmt(d.expenses)} so'm`,
    ...Object.entries(d.by_cat || {}).map(([k, v]) => `    ${CATS[k] || k}: ${fmt(v)}`),
    '', `💰 Kassa qoldig'i: ${fmt(d.cash)} so'm`,
  ];
  if (s.tg.profit) lines.push(`📈 Sof foyda: ${fmt(Number(d.profit) + Number(d.repair_income) - Number(d.expenses))} so'm`);
  lines.push(`💵 Kurs: 1$ = ${fmt(d.rate)} so'm`);

  // Rasm: QuickChart (Telegram rasmni URL orqali o'zi yuklab oladi)
  const chart = {
    type: 'horizontalBar',
    data: {
      labels: ['Sotuv', 'Remont', 'Rasxod'],
      datasets: [{ data: [d.revenue, d.repair_income, d.expenses].map(Number), backgroundColor: ['#2bb673', '#6ea6ee', '#f07d81'] }],
    },
    options: {
      legend: { display: false },
      title: { display: true, text: `${name} · ${dmy(day)} · kassa ${fmt(d.cash)} so'm`, fontColor: '#ffffff', fontSize: 20 },
      scales: {
        xAxes: [{ ticks: { beginAtZero: true, fontColor: '#cfd8d3' }, gridLines: { color: 'rgba(255,255,255,.08)' } }],
        yAxes: [{ ticks: { fontColor: '#ffffff', fontSize: 16 }, gridLines: { display: false } }],
      },
      plugins: { datalabels: { anchor: 'end', align: 'right', color: '#ffffff', font: { size: 16, weight: 'bold' } } },
    },
  };
  const photo = 'https://quickchart.io/chart?w=900&h=480&bkg=%230d1411&c=' + encodeURIComponent(JSON.stringify(chart));
  const text = lines.join('\n');
  try {
    await tg('sendPhoto', { chat_id: s.tg.group, photo, caption: text.slice(0, 1024) });
  } catch {
    await tg('sendMessage', { chat_id: s.tg.group, text }); // rasm chiqmasa ham matn yetib boradi
  }
}

async function all(db: Db, table: string) {
  const out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function sendBackup(db: Db, s: any, day: string) {
  const tables = ['settings', 'profiles', 'staff_pay', 'products', 'product_costs', 'stock_moves', 'clients',
    'repairs', 'sales', 'sale_items', 'sale_item_costs', 'expenses'];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) dump[t] = await all(db, t);
  const body = JSON.stringify({ app: 'comtech-servis', version: 1, created: new Date().toISOString(), tables: dump });
  const form = new FormData();
  form.append('chat_id', String(s.tg.channel));
  form.append('caption', `🗄 Baza zaxirasi · ${dmy(day)}\nTovarlar: ${dump.products.length} · Mijozlar: ${dump.clients.length} · Talonlar: ${dump.repairs.length} · Sotuvlar: ${dump.sales.length}`);
  form.append('document', new Blob([body], { type: 'application/json' }), `comtech-baza-${day}.json`);
  await tgForm('sendDocument', form);
}

async function notifyReady(db: Db, s: any) {
  const { data: list, error } = await db.from('repairs').select('*').eq('status', 'tayyor').is('notified_at', null).limit(20);
  if (error) throw error;
  let n = 0;
  for (const r of list || []) {
    const line = s.company?.lines?.servis || {};
    const text = `Assalomu alaykum, ${r.client_name}! ${s.company?.name || 'COM-TECH'} servisi: №${r.talon} talondagi ` +
      `${r.device}${r.model ? ' ' + r.model : ''} tayyor.` + (Number(r.fee_uzs) ? ` Narxi: ${fmt(r.fee_uzs)} so'm.` : '') +
      ` Olib ketishda talonni ko'rsating. Tel: ${line.phone || ''}`;
    let sent = false;
    const { data: cl } = await db.from('clients').select('tg_chat_id').eq('phone', r.client_phone).maybeSingle();
    if (cl?.tg_chat_id) { try { await tg('sendMessage', { chat_id: cl.tg_chat_id, text }); sent = true; } catch { /* bot bloklangan bo'lishi mumkin */ } }
    if (await sms(r.client_phone, text)) sent = true;
    // Xabar ketmasa ham qayta-qayta urinmaslik uchun belgilaymiz
    await db.from('repairs').update({ notified_at: new Date().toISOString() }).eq('talon', r.talon);
    if (sent) n++;
  }
  return n;
}

// Eskiz.uz SMS (ESKIZ_EMAIL va ESKIZ_PASSWORD sozlangan bo'lsa)
async function sms(phone: string, text: string) {
  const email = env('ESKIZ_EMAIL'), password = env('ESKIZ_PASSWORD');
  if (!email || !password) return false;
  const digits = '998' + phoneKey(phone);
  if (digits.length !== 12) return false;
  try {
    const login = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    }).then((r) => r.json());
    const token = login?.data?.token;
    if (!token) return false;
    const r = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mobile_phone: digits, message: text, from: env('ESKIZ_FROM', '4546') }),
    });
    return r.ok;
  } catch { return false; }
}
