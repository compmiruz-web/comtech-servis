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
// 3) "Tayyor" bo'lgan qurilmalar egalariga Telegram/SMS xabar ("Olib ketaman" tugmasi bilan)
// 4) Kam qolgan tovarlar haqida guruhga ogohlantirish
// 5) Yangi tovarlarni Telegram kanallarga joylash
// 6) Dushanba kuni haftalik, oyning 1-kuni oylik tahlil
// 7) Ustaxona nazorati: qabul/diagnostikadagi qurilmalar bo'yicha guruhga so'rov (javob bo'lmasa har 30 daqiqada qayta)

import * as XLSX from 'npm:xlsx@0.18.5';

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
      await tg('setWebhook', { url: `${env('SUPABASE_URL')}/functions/v1/tg-bot`, secret_token: secret, allowed_updates: ['message', 'channel_post', 'callback_query'] });
      await tg('setMyCommands', { commands: [{ command: 'holat', description: 'Qurilmalarim holati' }, { command: 'start', description: 'Raqamni ulash' }] }).catch(() => {});
      await db.from('settings').update({ webhook_ok: true }).eq('id', 1);
      done.push('webhook');
    }
    if (!env('TG_BOT_TOKEN')) return json({ ok: true, day, hm, note: 'TG_BOT_TOKEN hali qo\'shilmagan' });
    // Mijozlarga xabarlar birinchi: hisobot/zaxira xatosi ularni to'xtatib qo'ymasin
    try { done.push(`notified:${await notifyReady(db, s)}`); } catch (e) { done.push('notify-err:' + e); }
    try { done.push(`reminded:${await remindCredit(db, s, day)}`); } catch (e) { done.push('remind-err:' + e); }
    try { done.push(`low:${await lowStock(db, s)}`); } catch (e) { done.push('low-err:' + e); }
    try { done.push(`posted:${await channelPosts(db, s)}`); } catch (e) { done.push('post-err:' + e); }
    try { done.push(`asked:${await askRepairs(db, s, hm, force === 'diag')}`); } catch (e) { done.push('ask-err:' + e); }
    const f = s.features || {};
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (force === 'weekly' || (f.weekly !== false && dow === 1 && hm >= '09:00' && s.last_weekly !== day)) {
      try { await sendAnalytics(db, s, addDay(day, -7), addDay(day, -1), 'week'); done.push('weekly'); } catch (e) { done.push('weekly-err:' + e); }
      if (force !== 'weekly') await db.from('settings').update({ last_weekly: day }).eq('id', 1);
    }
    const prevMonth = (() => { const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 7); })();
    if (force === 'monthly' || (f.monthly !== false && day.endsWith('-01') && hm >= '09:00' && s.last_monthly !== prevMonth)) {
      try { await sendAnalytics(db, s, `${prevMonth}-01`, addDay(`${day.slice(0, 7)}-01`, -1), 'month'); done.push('monthly'); } catch (e) { done.push('monthly-err:' + e); }
      if (force !== 'monthly') await db.from('settings').update({ last_monthly: prevMonth }).eq('id', 1);
    }
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
    ...(Number(d.returns) ? [`↩️ Vazvrat: ${d.returns_count} ta · −${fmt(d.returns)} so'm`] : []),
    ...(Number(d.credit_sales) || Number(d.credit_in) ? [`🧾 Nasiya: berildi ${fmt(d.credit_sales)} · undirildi ${fmt(d.credit_in)} so'm`] : []),
    ...(Number(d.credit_overdue_count) ? [`⚠️ Muddati o'tgan nasiya: ${d.credit_overdue_count} ta · ${fmt(d.credit_overdue)} so'm`] : []),
    `🔧 Remont: qabul ${d.repairs_in} ta · topshirildi ${d.repairs_done} ta · ${fmt(d.repair_income)} so'm`,
    `💸 Rasxod: ${d.exp_count} ta · ${fmt(d.expenses)} so'm`,
    ...(await vendDay(db, day)),
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
  try { await sendDayExcel(db, s, day); } catch (e) { console.error('excel', e); }
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
    'repairs', 'sales', 'sale_items', 'sale_item_costs', 'expenses', 'supplier_debts', 'debt_payments', 'sale_returns', 'customer_debts', 'customer_payments', 'notifications',
    'vend_devices', 'vend_income', 'channel_posts'];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) dump[t] = await all(db, t);
  const body = JSON.stringify({ app: 'comtech-servis', version: 1, created: new Date().toISOString(), tables: dump });
  const form = new FormData();
  form.append('chat_id', String(s.tg.channel));
  const NAMES: Record<string, string> = { products: 'Tovarlar', clients: 'Mijozlar', repairs: 'Talonlar', sales: 'Sotuvlar', sale_items: 'Sotuv qatorlari', expenses: 'Rasxodlar', stock_moves: 'Ombor harakatlari', supplier_debts: 'Tovar qarzlari', customer_debts: 'Nasiyalar', customer_payments: 'Nasiya to\'lovlari', sale_returns: 'Vazvratlar', profiles: 'Xodimlar' };
  const total = Object.values(dump).reduce((a, r) => a + r.length, 0);
  form.append('caption', (`🗄 Baza zaxirasi · ${dmy(day)} · jami ${total} yozuv\n` + Object.entries(NAMES).map(([k, n]) => `${n}: ${dump[k]?.length ?? 0}`).join(' · ')).slice(0, 1024));
  form.append('document', new Blob([body], { type: 'application/json' }), `${s.company?.name || 'COMPMIR'}-baza-${day}.json`);
  await tgForm('sendDocument', form);
  try { await sendBackupExcel(s, day, dump); } catch (e) { console.error('excel', e); }
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
    const btn = { inline_keyboard: [[{ text: '🚗 Olib ketaman', callback_data: `pick:${r.talon}` }, { text: "📞 Qo'ng'iroq qiling", callback_data: `call:${r.talon}` }]] };
    if (cl?.tg_chat_id) { try { await tg('sendMessage', { chat_id: cl.tg_chat_id, text, reply_markup: btn }); sent = true; } catch { /* bot bloklangan bo'lishi mumkin */ } }
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


// Nasiya muddati yaqinlashgan yoki o'tgan mijozlarga eslatma (har 3 kunda bir marta)
async function remindCredit(db: Db, s: any, day: string) {
  const { data: list, error } = await db.rpc('credit_to_remind');
  if (error) throw error;
  let n = 0;
  for (const d of list || []) {
    const left = Number(d.amount_uzs) - Number(d.paid_uzs);
    if (left <= 0) continue;
    const late = d.due_date < day;
    const text = `Assalomu alaykum, ${d.client_name}! ${s.company?.name || 'COMPMIR'}: ${fmt(left)} so'm qarzingizning to'lash muddati ` +
      `${dmy(d.due_date)}${late ? ' edi, muddati o\'tdi' : ''}. Iltimos, to'lovni amalga oshiring. Tel: ${s.company?.lines?.servis?.phone || ''}`;
    let sent = false;
    const { data: cl } = await db.from('clients').select('tg_chat_id').eq('phone', d.client_phone).maybeSingle();
    if (cl?.tg_chat_id) { try { await tg('sendMessage', { chat_id: cl.tg_chat_id, text }); sent = true; } catch { /* bot bloklangan */ } }
    if (await sms(d.client_phone, text)) sent = true;
    await db.from('customer_debts').update({ last_reminded: day }).eq('id', d.id);
    if (sent) n++;
  }
  return n;
}


// ===== Excel fayllar (kunlik hisobot va baza nusxasi) =====
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function uzRange(day: string) { const f = new Date(`${day}T00:00:00+05:00`); return [f.toISOString(), new Date(f.getTime() + 864e5).toISOString()]; }
const uzTime = (t: string | null) => t ? new Date(t).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '';
const PAYN_X: Record<string, string> = { naqd: 'Naqd', karta: 'Karta', otkazma: "O'tkazma", nasiya: 'Nasiya' };
function sheet(rows: unknown[][], widths?: number[]) { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map((w) => ({ wch: w })); return ws; }

async function sendDayExcel(db: Db, s: any, day: string) {
  const [a, b] = uzRange(day);
  const showProfit = !!s.tg?.profit;
  const { data: profs } = await db.from('profiles').select('id,name');
  const nm = (id: string | null) => (profs || []).find((p: any) => p.id === id)?.name || '';
  const { data: sales } = await db.from('sales').select('*, sale_items(*, sale_item_costs(*))').gte('created_at', a).lt('created_at', b).order('created_at');
  const { data: exps } = await db.from('expenses').select('*').gte('created_at', a).lt('created_at', b).order('created_at');
  const { data: rets } = await db.from('sale_returns').select('*, sale_items(name), sales(no)').gte('created_at', a).lt('created_at', b).order('created_at');
  const { data: reps } = await db.from('repairs').select('*').or(`and(created_at.gte.${a},created_at.lt.${b}),and(done_at.gte.${a},done_at.lt.${b})`).order('talon');
  const { data: d } = await db.rpc('day_summary', { p_day: day });
  const name = s.company?.name || 'COMPMIR';

  const sum: unknown[][] = [[`${name} — ${dmy(day)} kunlik hisobot`], [],
    ['Sotuvlar soni', Number(d?.sales_count || 0)], ['Savdo tushumi (so\'m)', Number(d?.revenue || 0)],
    ...Object.entries(d?.by_pay || {}).map(([k, v]) => [`   ${PAYN_X[k] || k}`, Number(v)]),
    ['Vazvrat (so\'m)', Number(d?.returns || 0)], ['Remont daromadi (so\'m)', Number(d?.repair_income || 0)],
    ['Remont qabul / topshirildi', `${d?.repairs_in || 0} / ${d?.repairs_done || 0}`],
    ['Rasxodlar (so\'m)', Number(d?.expenses || 0)], ['Nasiya berildi (so\'m)', Number(d?.credit_sales || 0)], ['Nasiya undirildi (so\'m)', Number(d?.credit_in || 0)],
    ['Kassa qoldig\'i (so\'m)', Number(d?.cash || 0)], ['Dollar kursi', Number(d?.rate || s.rate || 0)]];
  if (showProfit) sum.push(['Sof foyda (so\'m)', Number(d?.profit || 0) + Number(d?.repair_income || 0) - Number(d?.expenses || 0)]);

  const sh: unknown[][] = [['Vaqt', 'Chek №', 'Tovar', 'Soni', 'Narxi (so\'m)', 'Summa (so\'m)', 'Asl narx', 'To\'lov', 'Sotuvchi', ...(showProfit ? ['Tannarx (so\'m)', 'Foyda (so\'m)'] : [])]];
  for (const x of sales || []) for (const i of x.sale_items || []) {
    const c = Array.isArray(i.sale_item_costs) ? i.sale_item_costs[0] : i.sale_item_costs;
    const cost = c ? Number(c.cost_usd) * Number(c.rate) * i.qty : 0, tot = Number(i.price_uzs) * i.qty;
    sh.push([uzTime(x.created_at), x.no, i.name, i.qty, Number(i.price_uzs), tot, Number(i.list_price_uzs || i.price_uzs), PAYN_X[x.pay] || x.pay, nm(x.user_id), ...(showProfit ? [Math.round(cost), Math.round(tot - cost)] : [])]);
  }
  const eh: unknown[][] = [['Vaqt', 'Turi', 'Summa (so\'m)', 'Kimga', 'Izoh', 'Kiritdi']];
  for (const e of exps || []) eh.push([uzTime(e.created_at), CATS[e.cat] || e.cat, Number(e.amount_uzs), nm(e.to_user), e.note || '', nm(e.user_id)]);
  const rh: unknown[][] = [['Vaqt', 'Chek №', 'Tovar', 'Soni', 'Qaytarildi (so\'m)', 'Sabab', 'Kim']];
  for (const r of rets || []) rh.push([uzTime(r.created_at), r.sales?.no || '', r.sale_items?.name || '', r.qty, Number(r.refund_uzs), r.reason || '', nm(r.user_id)]);
  const ph: unknown[][] = [['Talon', 'Qabul', 'Mijoz', 'Telefon', 'Qurilma', 'Muammo', 'Holati', 'Narxi (so\'m)', 'Usta', 'Topshirildi']];
  for (const r of reps || []) ph.push([r.talon, uzTime(r.created_at), r.client_name, r.client_phone, [r.device, r.model].filter(Boolean).join(' '), r.problem, r.status, Number(r.fee_uzs || 0), nm(r.master_id), uzTime(r.done_at)]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(sum, [32, 18]), 'Xulosa');
  XLSX.utils.book_append_sheet(wb, sheet(sh, [20, 8, 50, 6, 14, 14, 14, 10, 18, 14, 14]), 'Sotuvlar');
  XLSX.utils.book_append_sheet(wb, sheet(eh, [20, 18, 14, 18, 30, 18]), 'Rasxodlar');
  XLSX.utils.book_append_sheet(wb, sheet(rh, [20, 8, 40, 6, 14, 24, 18]), 'Vazvratlar');
  XLSX.utils.book_append_sheet(wb, sheet(ph, [8, 20, 20, 16, 26, 30, 12, 14, 18, 20]), 'Remontlar');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const form = new FormData();
  form.append('chat_id', String(s.tg.group));
  form.append('caption', `📊 ${name} · ${dmy(day)} kunlik hisobot (Excel)`);
  form.append('document', new Blob([buf], { type: XLSX_MIME }), `${name}-hisobot-${day}.xlsx`);
  await tgForm('sendDocument', form);
}

async function sendBackupExcel(s: any, day: string, dump: Record<string, unknown[]>) {
  const wb = XLSX.utils.book_new();
  for (const [t, rows] of Object.entries(dump)) {
    const flat = (rows as any[]).map((r) => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])));
    XLSX.utils.book_append_sheet(wb, flat.length ? XLSX.utils.json_to_sheet(flat) : XLSX.utils.aoa_to_sheet([['(bo\'sh)']]), t.slice(0, 31));
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const form = new FormData();
  form.append('chat_id', String(s.tg.channel));
  form.append('caption', `🗄 Baza zaxirasi (Excel) · ${dmy(day)}`);
  form.append('document', new Blob([buf], { type: XLSX_MIME }), `${s.company?.name || 'COMPMIR'}-baza-${day}.xlsx`);
  await tgForm('sendDocument', form);
}


// ===== Yangi imkoniyatlar =====
const addDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lineName = (s: any, k: string) => ({ noutbuk: 'Noutbuklar', kompyuter: 'Kompyuter / qismlar', servis: 'Servis' } as Record<string, string>)[k] || s.company?.lines?.[k]?.title || k;

async function vendDay(db: Db, day: string) {
  try {
    const [a, b] = uzRange(day);
    const { data } = await db.from('vend_income').select('amount_uzs').gte('created_at', a).lt('created_at', b);
    const sum = (data || []).reduce((x: number, r: any) => x + Number(r.amount_uzs), 0);
    return sum ? [`🤖 Avtomatlar: ${data!.length} ta · ${fmt(sum)} so'm`] : [];
  } catch { return []; }
}

async function lowStock(db: Db, s: any) {
  const { data: list, error } = await db.rpc('low_stock_check');
  if (error) throw error;
  if (!list?.length || !s.tg?.group) return 0;
  const text = `⚠️ Kam qolgan tovarlar — buyurtma qilish kerak (${list.length} ta):\n\n` +
    list.slice(0, 40).map((x: any) => `• ${x.name} — ${x.qty} dona qoldi${x.barcode ? ` (${x.barcode})` : ''}`).join('\n') +
    (list.length > 40 ? `\n… yana ${list.length - 40} ta` : '');
  await tg('sendMessage', { chat_id: s.tg.group, text: text.slice(0, 4000) });
  return list.length;
}

const chatOf = (c: string) => { c = String(c || '').trim(); if (!c) return ''; if (/^-?\d+$/.test(c) || c.startsWith('@')) return c; return '@' + c.replace(/^https?:\/\/t\.me\//, ''); };
const warTxt = (w: any) => w && Number(w.n) > 0 ? `${Number(w.n)} ${({ kun: 'kun', oy: 'oy', yil: 'yil' } as Record<string, string>)[w.u] || 'oy'}` : '';

async function channelPosts(db: Db, s: any) {
  const f = s.features || {};
  const cutoff = new Date(Date.now() - 10 * 60000).toISOString(); // avtomatik joylashdan oldin 10 daqiqa: rasm va narxni qo'shib ulgurish uchun
  const { data: q, error } = await db.from('channel_posts').select('id, manual, created_at, product_id, products(*)')
    .is('posted_at', null).is('error', null).order('created_at').limit(8);
  if (error) throw error;
  let n = 0;
  for (const it of q || []) {
    if (!it.manual && it.created_at > cutoff) continue;
    const p: any = Array.isArray(it.products) ? it.products[0] : it.products;
    try {
      if (!p) throw new Error('tovar o\'chirilgan');
      const chat = chatOf(f.channels?.[p.line]);
      if (!chat) throw new Error('bo\'lim uchun kanal yozilmagan');
      if (!it.manual && p.qty <= 0) throw new Error('omborda qolmagan');
      const price = p.sell_uzs ? Number(p.sell_uzs) : Math.ceil(Number(p.sell_usd) * Number(s.rate) / 1000) * 1000;
      const ln = s.company?.lines?.[p.line] || {}, w = warTxt(p.warranty || f.warranty?.[p.line]);
      const parts = String(p.name).split('|').map((x) => x.trim()).filter(Boolean);
      const caption = [
        `🆕 ${parts[0]}`, ...parts.slice(1).map((x) => `▫️ ${x}`), '',
        `💰 Narxi: ${fmt(price)} so'm`, ...(w ? [`🛡 Kafolat: ${w}`] : []), ...(p.qty > 1 ? [`📦 Mavjud: ${p.qty} dona`] : []), '',
        ...(ln.phone ? [`📞 ${ln.phone}`] : []), [ln.telegram && `✈️ ${ln.telegram}`, ln.instagram && `📷 ${ln.instagram}`].filter(Boolean).join(' · '),
      ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
      const msg = p.photo
        ? await tg('sendPhoto', { chat_id: chat, photo: p.photo, caption: caption.slice(0, 1024) })
        : await tg('sendMessage', { chat_id: chat, text: caption.slice(0, 4000) });
      await db.from('channel_posts').update({ posted_at: new Date().toISOString(), message_id: msg?.message_id || null }).eq('id', it.id);
      n++;
    } catch (e) {
      const m = String((e as Error)?.message || e);
      await db.from('channel_posts').update({ error: m.slice(0, 300) }).eq('id', it.id);
      if (it.manual && s.tg?.group) {
        await tg('sendMessage', { chat_id: s.tg.group, text: `❗️ Kanalga joylab bo'lmadi: ${p?.name || ''}\n${m}\n\nBot kanalga admin qilib qo'shilganini tekshiring.` }).catch(() => {});
      }
    }
  }
  return n;
}

async function sendAnalytics(db: Db, s: any, from: string, to: string, kind: 'week' | 'month') {
  const { data: a, error } = await db.rpc('analytics', { p_from: from, p_to: to });
  if (error) throw error;
  const t = a.totals || {}, name = s.company?.name || 'COMPMIR';
  const MON = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  const title = kind === 'week' ? `haftalik tahlil · ${dmy(from)}–${dmy(to)}` : `oylik tahlil · ${MON[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  const medal = (i: number) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  const base = [
    `📈 ${name} · ${title}`, '',
    `🛒 Sotuv: ${t.sales || 0} ta chek · ${fmt(t.revenue)} so'm`,
    `🔧 Remont: ${(a.masters || []).reduce((x: number, m: any) => x + Number(m.cnt), 0)} ta topshirildi · ${fmt(t.repair)} so'm (qabul: ${a.repairs_in} ta)`,
    ...(Number(t.vend) ? [`🤖 Avtomatlar: ${fmt(t.vend)} so'm`] : []),
    `💸 Rasxod: ${fmt(t.expenses)} so'm`,
  ];
  const profitLines = [`📊 Savdo foydasi: ${fmt(t.profit)} so'm`, `💰 Sof foyda: ${fmt(t.net)} so'm`];
  const rest = [
    ...(a.top?.length ? ['', '🏆 Eng ko\'p sotilgan:', ...a.top.slice(0, 5).map((x: any, i: number) => `${medal(i)} ${String(x.name).split('|')[0].trim()} — ${x.qty} dona`)] : []),
    ...(a.lines?.length ? ['', '🏬 Bo\'limlar:', ...a.lines.map((x: any) => `• ${lineName(s, x.line)}: ${fmt(x.revenue)} so'm`)] : []),
    ...(a.sellers?.length ? ['', '👤 Sotuvchilar:', ...a.sellers.map((x: any, i: number) => `${medal(i)} ${x.name || '—'} — ${fmt(x.revenue)} so'm (${x.sales} ta)`)] : []),
    ...(a.masters?.length ? ['', '🔧 Ustalar:', ...a.masters.map((x: any, i: number) => `${medal(i)} ${x.name} — ${x.cnt} ta · ${fmt(x.income)} so'm`)] : []),
  ];
  const groupText = [...base, ...(s.tg?.profit ? profitLines : []), ...rest].join('\n');
  const days = a.days || [];
  const chart = {
    type: 'bar',
    data: {
      labels: days.map((d: any) => kind === 'week' ? ['Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Ya'][(new Date(`${d.d}T12:00:00Z`).getUTCDay() + 6) % 7] : String(d.d).slice(8, 10)),
      datasets: [
        { label: 'Sotuv', data: days.map((d: any) => Number(d.revenue)), backgroundColor: '#2bb673' },
        { label: 'Remont', data: days.map((d: any) => Number(d.repair)), backgroundColor: '#6ea6ee' },
        { label: 'Rasxod', data: days.map((d: any) => Number(d.expenses)), backgroundColor: '#f07d81' },
      ],
    },
    options: {
      title: { display: true, text: `${name} · ${title}`, fontColor: '#ffffff', fontSize: 18 },
      legend: { labels: { fontColor: '#ffffff' } },
      scales: { xAxes: [{ ticks: { fontColor: '#cfd8d3' }, gridLines: { display: false } }], yAxes: [{ ticks: { beginAtZero: true, fontColor: '#cfd8d3' }, gridLines: { color: 'rgba(255,255,255,.08)' } }] },
    },
  };
  const photo = 'https://quickchart.io/chart?w=1000&h=520&bkg=%230d1411&c=' + encodeURIComponent(JSON.stringify(chart));
  if (s.tg?.group) {
    try {
      if (groupText.length <= 1024) await tg('sendPhoto', { chat_id: s.tg.group, photo, caption: groupText });
      else { await tg('sendPhoto', { chat_id: s.tg.group, photo }); await tg('sendMessage', { chat_id: s.tg.group, text: groupText.slice(0, 4000) }); }
    } catch { await tg('sendMessage', { chat_id: s.tg.group, text: groupText.slice(0, 4000) }); }
  }
  // Rahbarga dasturda (foyda bilan)
  await db.from('notifications').insert({
    kind: kind === 'week' ? 'week' : 'month', level: Number(t.net) >= 0 ? 'good' : 'bad',
    title: `${kind === 'week' ? 'Haftalik' : 'Oylik'} tahlil: sof foyda ${fmt(t.net)} so'm`,
    body: [...base.slice(2), ...profitLines, ...rest].join('\n'), ref: `${kind}-${from}`,
  }).then(() => {}, () => {});
}


// ===== Ustaxona nazorati: guruhga "Diagnostika qildingizmi?" so'rovi =====
// Javob bo'lmasa har 30 daqiqada qayta (eski so'rov o'chirilib, yangisi pastga tushadi).
// Faqat ish vaqtida (Sozlamalar → Avtomatik xabarlar: odatiy 09:00–20:00).
const ASK_EVERY_MIN = 30;
const ageTxt = (t: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  if (m < 60) return `${m} daqiqa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} soat`;
  const d = Math.floor(h / 24), hh = h % 24;
  return `${d} kun${hh ? ` ${hh} soat` : ''}`;
};
function askButtons(talon: number, status: string) {
  const row1 = status === 'qabul'
    ? [{ text: '🔍 Diagnostika qilinyapti', callback_data: `dq:diag:${talon}` }, { text: "🔧 Ta'mirga o'tdi", callback_data: `dq:tamir:${talon}` }]
    : [{ text: "🔧 Ta'mirga o'tdi", callback_data: `dq:tamir:${talon}` }];
  return { inline_keyboard: [row1, [{ text: '✅ Tayyor', callback_data: `dq:tayyor:${talon}` }, { text: '⏳ 1 soatdan keyin so\'ra', callback_data: `dq:snooze:${talon}` }]] };
}

// N kundan eski, holati yangilanmagan talonlar — kuniga bir marta bitta umumiy xabar
async function staleSummary(db: Db, s: any, days: number) {
  const { day } = tashkentNow();
  if (s.features?.lastStale === day) return;
  const { data: old, error } = await db.from('repairs').select('talon,created_at,status')
    .in('status', ['qabul', 'diag', 'tamir']).lt('created_at', new Date(Date.now() - days * 864e5).toISOString()).order('talon');
  if (error) throw error;
  await db.from('settings').update({ features: { ...(s.features || {}), lastStale: day } }).eq('id', 1);
  s.features = { ...(s.features || {}), lastStale: day };
  if (!old?.length) return;
  const cnt: Record<string, number> = {};
  for (const r of old) cnt[r.status] = (cnt[r.status] || 0) + 1;
  const NM: Record<string, string> = { qabul: 'Qabul qilindi', diag: 'Diagnostikada', tamir: "Ta'mirda" };
  const nums = old.slice(0, 60).map((r: any) => `№${r.talon}`).join(', ') + (old.length > 60 ? ` … yana ${old.length - 60} ta` : '');
  await tg('sendMessage', { chat_id: s.tg.group, text: [
    `🕰 ${days} kundan ortiq turgan, holati yangilanmagan talonlar: ${old.length} ta`,
    Object.entries(cnt).map(([k, v]) => `• ${NM[k] || k}: ${v} ta`).join('\n'), '',
    nums, '',
    "Iltimos, dasturda holatini yangilang (topshirilgan bo'lsa — \"Topshirildi\"). Bu xabar kuniga bir marta keladi.",
  ].join('\n').slice(0, 4000) });
}

async function askRepairs(db: Db, s: any, hm: string, force: boolean) {
  const f = s.features || {};
  if (f.diagAsk === false || !s.tg?.group) return 0;
  const from = f.askFrom || '09:00', to = f.askTo || '20:00';
  if (!s.features?.diagAskHello) {
    // Birinchi ishga tushganda guruhga tekshiruv xabari (bot guruhga yoza olishini ko'rsatadi)
    await tg('sendMessage', { chat_id: s.tg.group, text: `✅ Ustaxona nazorati yoqildi.\n\nQabul qilingan qurilmalar bo'yicha shu guruhga "Diagnostika qildingizmi?" deb so'rayman. Javob berilmasa har ${ASK_EVERY_MIN} daqiqada qayta so'rayman (ish vaqti: ${from}–${to}).` });
    s.features = { ...(s.features || {}), diagAskHello: true };
    await db.from('settings').update({ features: s.features }).eq('id', 1);
  }
  if (!force && (hm < from || hm >= to)) return 0;
  let q = db.from('repairs').select('talon,created_at,status_at,status,client_name,device,model,problem,master_id,ask_msg_id,ask_count')
    .in('status', ['qabul', 'diag']).not('ask_next_at', 'is', null).order('talon').limit(15);
  const days = Number(f.askDays) || 7; // faqat oxirgi N kunda qabul qilinganlar alohida so'raladi
  q = q.gte('created_at', new Date(Date.now() - days * 864e5).toISOString());
  if (!force) q = q.lte('ask_next_at', new Date().toISOString());
  try { await staleSummary(db, s, days); } catch (e) { console.error('stale', e); }
  const { data: list, error } = await q;
  if (error) throw error;
  if (!list?.length) return 0;
  const { data: profs } = await db.from('profiles').select('id,name');
  const nm = (id: string | null) => (profs || []).find((p: any) => p.id === id)?.name || '—';
  let n = 0;
  for (const r of list) {
    const cnt = Number(r.ask_count || 0) + 1;
    const head = r.status === 'qabul'
      ? `🔍 №${r.talon} — diagnostika qildingizmi?`
      : `🔧 №${r.talon} — diagnostika natijasi qanday? Ta'mirga o'tdimi?`;
    const text = [
      head, '',
      `📱 ${r.device}${r.model ? ' ' + r.model : ''}`,
      `❗️ Muammo: ${r.problem}`,
      `👤 Mijoz: ${r.client_name}`,
      `🛠 Usta: ${nm(r.master_id)}`,
      `⏱ Servisda: ${ageTxt(r.created_at)}${r.status === 'diag' ? ` · diagnostikada: ${ageTxt(r.status_at || r.created_at)}` : ''}`,
      ...(cnt > 1 ? ['', `⚠️ ${cnt}-marta so'ralyapti — javob berilmadi!`] : []),
    ].join('\n');
    if (r.ask_msg_id) await tg('deleteMessage', { chat_id: s.tg.group, message_id: r.ask_msg_id }).catch(() => {});
    const msg = await tg('sendMessage', { chat_id: s.tg.group, text, reply_markup: askButtons(r.talon, r.status) });
    await db.from('repairs').update({
      ask_msg_id: msg?.message_id || null, ask_count: cnt,
      ask_next_at: new Date(Date.now() + ASK_EVERY_MIN * 60000).toISOString(),
    }).eq('talon', r.talon);
    n++;
  }
  return n;
}
