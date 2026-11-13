// Har 5 daqiqada pg_cron chaqiradi.
// 1) reportTime bo'lganda guruhga kunlik hisobot (rasm + matn)
// 2) backupTime bo'lganda kanalga butun baza (JSON fayl)
// 3) "Tayyor" bo'lgan qurilmalar egalariga Telegram/SMS xabar ("Olib ketaman" tugmasi bilan)
// 4) Kam qolgan tovarlar haqida guruhga ogohlantirish
// 5) Yangi tovarlarni Telegram kanallarga joylash
// 6) Dushanba kuni haftalik, oyning 1-kuni oylik tahlil
// 7) Ustaxona nazorati: qabul/diagnostikadagi qurilmalar bo'yicha guruhga so'rov (javob bo'lmasa har 30 daqiqada qayta)
import { admin, CATS, dmy, env, fmt, json, PAYS, phoneKey, tashkentNow, tg, tgForm } from '../_shared/common.ts';

import XLSX from 'npm:xlsx-js-style@1.2.0';

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
    // Bot nomi (talondagi QR kod uchun) — bir marta aniqlanadi
    if (!s.tg?.bot) {
      try { const me = await tg('getMe', {}); if (me?.username) { s.tg = { ...(s.tg || {}), bot: me.username }; await db.from('settings').update({ tg: s.tg }).eq('id', 1); done.push('bot:' + me.username); } } catch (e) { done.push('getMe-err:' + e); }
    }
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
    'vend_devices', 'vend_income', 'channel_posts', 'supplier_payments'];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) dump[t] = await all(db, t);
  const body = JSON.stringify({ app: 'comtech-servis', version: 1, created: new Date().toISOString(), tables: dump });
  const form = new FormData();
  form.append('chat_id', String(s.tg.channel));
  const NAMES: Record<string, string> = { products: 'Tovarlar', clients: 'Mijozlar', repairs: 'Talonlar', sales: 'Sotuvlar', sale_items: 'Sotuv qatorlari', expenses: 'Rasxodlar', stock_moves: 'Ombor harakatlari', supplier_debts: 'Tovar qarzlari', supplier_payments: 'Berilgan qarzlar', customer_debts: 'Nasiyalar', customer_payments: 'Nasiya to\'lovlari', sale_returns: 'Vazvratlar', profiles: 'Xodimlar' };
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

  const sub = `${dmy(day)} · kurs 1$ = ${Number(d?.rate || s.rate || 0).toLocaleString('ru-RU')} so'm`;
  const toCols = (h: unknown[], types: Record<number, XCol['t']>, wrap: number[] = []) => h.map((x, i) => ({ h: String(x), t: types[i], wrap: wrap.includes(i), max: wrap.includes(i) ? 50 : 30 } as XCol));
  const body = (rows: unknown[][]) => rows.slice(1).map((v) => ({ v } as XRow));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, xSheet(`${name} — kunlik hisobot`, sub, [{ h: "Ko'rsatkich", max: 36 }, { h: 'Qiymat', t: 'uzs' }],
    sum.slice(2).map((v) => ({ v, font: String(v[0]).startsWith('   ') ? XC.muted : undefined } as XRow))), 'Xulosa');
  XLSX.utils.book_append_sheet(wb, xSheet(`${name} — sotuvlar`, sub, toCols(sh[0], { 1: 'int', 3: 'int', 4: 'uzs', 5: 'uzs', 6: 'uzs', 9: 'uzs', 10: 'uzs' }, [2]), body(sh)), 'Sotuvlar');
  XLSX.utils.book_append_sheet(wb, xSheet(`${name} — rasxodlar`, sub, toCols(eh[0], { 2: 'uzs' }, [4]), body(eh)), 'Rasxodlar');
  XLSX.utils.book_append_sheet(wb, xSheet(`${name} — vazvratlar`, sub, toCols(rh[0], { 1: 'int', 3: 'int', 4: 'uzs' }, [2]), body(rh)), 'Vazvratlar');
  XLSX.utils.book_append_sheet(wb, xSheet(`${name} — remontlar`, sub, toCols(ph[0], { 0: 'int', 7: 'uzs' }, [5]),
    ph.slice(1).map((v) => ({ v: [...v.slice(0, 6), (XST[String(v[6])] || [v[6]])[0], ...v.slice(7)], cellFill: { 6: (XST[String(v[6])] || ['', 'FFFFFF'])[1] } } as XRow))), 'Remontlar');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const form = new FormData();
  form.append('chat_id', String(s.tg.group));
  form.append('caption', `📊 ${name} · ${dmy(day)} kunlik hisobot (Excel)`);
  form.append('document', new Blob([buf], { type: XLSX_MIME }), `${name}-hisobot-${day}.xlsx`);
  await tgForm('sendDocument', form);
}

// ===== Chiroyli Excel (ranglar dastur dizayni kabi: indigo → firuza) =====
type XCol = { h: string; t?: 'uzs' | 'usd' | 'int' | 'txt'; max?: number; wrap?: boolean };
type XRow = { v: unknown[]; k?: 'sec' | 'sub' | 'tot'; fill?: string; font?: string; cellFill?: Record<number, string> };
const XC = { ink: '16132E', head: '1F1A4D', title: '4A35B8', teal: '0E8F93', zebra: 'F6F4FD', line: 'D9D4F0', white: 'FFFFFF', muted: '69658C',
  sec: ['6447EE', '0E8F93', 'D0457A', '2B67D1', 'B26A00', '3B8F3B', '8A4FD8', '0F6B66'] };
const xb = (rgb: string) => ({ style: 'thin', color: { rgb } });
const XBORDER = { top: xb(XC.line), bottom: xb(XC.line), left: xb(XC.line), right: xb(XC.line) };
const XFMT: Record<string, string> = { uzs: '#,##0', usd: '"$"#,##0.00', int: '0' };
const xLen = (v: unknown, t?: string) => v == null || v === '' ? 0 : typeof v === 'number' ? (t === 'usd' ? v.toFixed(2).length + 4 : Math.round(v).toLocaleString('en-US').length + 1) : Math.max(...String(v).split('\n').map((l) => l.length));

function xSheet(title: string, sub: string, cols: XCol[], rows: XRow[]) {
  const n = cols.length, aoa: unknown[][] = [[title], [sub], cols.map((c) => c.h), ...rows.map((r) => r.v)];
  const ws: any = XLSX.utils.aoa_to_sheet(aoa);
  const merges: any[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: n - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: n - 1 } }];
  const cell = (r: number, c: number) => { const a = XLSX.utils.encode_cell({ r, c }); return ws[a] || (ws[a] = { t: 's', v: '' }); };
  for (let c = 0; c < n; c++) {
    cell(0, c).s = { fill: { fgColor: { rgb: XC.title } }, font: { bold: true, sz: 15, color: { rgb: XC.white } }, alignment: { vertical: 'center' } };
    cell(1, c).s = { fill: { fgColor: { rgb: XC.head } }, font: { sz: 10, color: { rgb: 'C9BDFF' } }, alignment: { vertical: 'center' } };
    cell(2, c).s = { fill: { fgColor: { rgb: XC.teal } }, font: { bold: true, sz: 10, color: { rgb: XC.white } }, border: XBORDER,
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
  }
  let z = 0;
  rows.forEach((r, i) => {
    const R = i + 3;
    if (r.k === 'sec') {
      merges.push({ s: { r: R, c: 0 }, e: { r: R, c: n - 1 } }); z = 0;
      for (let c = 0; c < n; c++) cell(R, c).s = { fill: { fgColor: { rgb: r.fill || XC.sec[0] } }, font: { bold: true, sz: 12, color: { rgb: XC.white } }, alignment: { vertical: 'center' } };
      return;
    }
    const tot = r.k === 'sub' || r.k === 'tot';
    const bg = r.k === 'tot' ? XC.head : r.k === 'sub' ? 'E9E4FF' : r.fill || (z++ % 2 ? XC.zebra : XC.white);
    for (let c = 0; c < n; c++) {
      const x = cell(R, c), t = cols[c].t;
      x.s = { fill: { fgColor: { rgb: r.cellFill?.[c] || bg } }, border: XBORDER,
        font: { sz: 10, bold: tot, color: { rgb: r.k === 'tot' ? XC.white : r.font || XC.ink } },
        alignment: { vertical: 'top', wrapText: !!cols[c].wrap, horizontal: t && t !== 'txt' ? 'right' : 'left' } };
      if (typeof x.v === 'number' && t && XFMT[t]) x.s.numFmt = XFMT[t];
    }
  });
  ws['!merges'] = merges;
  ws['!cols'] = cols.map((c, i) => ({ wch: Math.min(c.max || 42, Math.max(6, Math.ceil(c.h.length * 0.8) + 2, ...rows.filter((r) => r.k !== 'sec').map((r) => xLen(r.v[i], c.t) + 2))) }));
  ws['!rows'] = [{ hpt: 28 }, { hpt: 18 }, { hpt: 30 }];
  if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + rows.length, c: n - 1 } }) };
  return ws;
}
const xN = (v: unknown) => v == null || v === '' ? '' : Number(v);
const xT = (t: string | null) => t ? new Date(t).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const xD = (t: string | null) => t ? new Date(t).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '';
const xDay = (t: string) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
const XST: Record<string, [string, string]> = { qabul: ['Qabul qilindi', 'E3ECFF'], diag: ['Diagnostikada', 'FFF0D6'], tamir: ["Ta'mirda", 'FFE6C7'], tayyor: ['✅ Tayyor', 'D9F5EC'], berildi: ['Berildi', 'ECECF2'] };
const XROLE: Record<string, string> = { owner: 'Rahbar', usta: 'Usta', sotuvchi: 'Sotuvchi', usta_sotuvchi: 'Usta va sotuvchi' };
const xWar = (w: any) => w && w.n ? `${w.n} ${w.u || 'oy'}` : '';

function buildBackupBook(s: any, day: string, dump: Record<string, any[]>) {
  const rate = Number(s.rate || 0), name = s.company?.name || 'COMPMIR', stamp = `Zaxira: ${dmy(day)} 00:00 · kurs 1$ = ${rate.toLocaleString('ru-RU')} so'm`;
  const T = (k: string) => (dump[k] || []) as any[];
  const prof = Object.fromEntries(T('profiles').map((p) => [p.id, p]));
  const nm = (id: string | null) => (id && prof[id]?.name) || '';
  const cost = Object.fromEntries(T('product_costs').map((c) => [c.product_id, Number(c.cost_usd)]));
  const sales = Object.fromEntries(T('sales').map((x) => [x.id, x]));
  const icost = Object.fromEntries(T('sale_item_costs').map((c) => [c.item_id, c]));
  const clients = Object.fromEntries(T('clients').map((c) => [c.phone, c]));
  const wb = XLSX.utils.book_new();
  const add = (ws: any, t: string) => XLSX.utils.book_append_sheet(wb, ws, t);

  // --- Ombor: bo'limlar bo'yicha
  const lines = [...new Set(T('products').map((p) => p.line))].sort((a, b) => { const o = (x: string) => { const i = ['noutbuk', 'kompyuter'].indexOf(x); return i < 0 ? 9 : i; }; return o(a) - o(b) || String(a).localeCompare(String(b)); });
  const oc: XCol[] = [{ h: '№', t: 'int' }, { h: 'Nomi', max: 60, wrap: true }, { h: 'Shtrix-kod' }, { h: 'Soni', t: 'int' }, { h: 'Kelish narxi ($)', t: 'usd' },
    { h: "Sotish narxi (so'm)", t: 'uzs' }, { h: 'Sotish narxi ($)', t: 'usd' }, { h: 'Kelish jami ($)', t: 'usd' }, { h: "Sotish jami (so'm)", t: 'uzs' }, { h: 'Kafolat' }, { h: 'Oxirgi kirim' }];
  const or: XRow[] = []; let gq = 0, gc = 0, gs = 0, gk = 0;
  lines.forEach((ln, li) => {
    const ps = T('products').filter((p) => p.line === ln).sort((a, b) => b.qty - a.qty || String(a.name).localeCompare(String(b.name)));
    const live = ps.filter((p) => p.qty > 0);
    or.push({ k: 'sec', v: [`📦 ${lineName(s, ln)} — ${live.length} xil, ${live.reduce((a, p) => a + p.qty, 0)} dona`], fill: XC.sec[li % XC.sec.length] });
    let q = 0, c = 0, so = 0;
    ps.forEach((p, i) => {
      const cu = cost[p.id] || 0, su = p.sell_uzs ? Number(p.sell_uzs) : Math.round(Number(p.sell_usd || 0) * rate), sd = p.sell_uzs ? (rate ? Number(p.sell_uzs) / rate : 0) : Number(p.sell_usd || 0);
      q += p.qty; c += cu * p.qty; so += su * p.qty;
      or.push({ v: [i + 1, p.name, p.barcode, p.qty, cu || '', su || '', sd ? +sd.toFixed(2) : '', cu ? +(cu * p.qty).toFixed(2) : '', su * p.qty || '', xWar(p.warranty), xD(p.last_in || p.created_at)],
        font: p.qty ? undefined : '9A97B5', cellFill: p.qty > 0 && p.min_qty && p.qty <= p.min_qty ? { 3: 'FDE4EA' } : undefined });
    });
    or.push({ k: 'sub', v: ['', `Jami: ${lineName(s, ln)}`, '', q, '', '', '', +c.toFixed(2), so, '', ''] });
    gq += q; gc += c; gs += so; gk += live.length;
  });
  or.push({ k: 'tot', v: ['', `UMUMIY OMBOR — ${gk} xil`, '', gq, '', '', '', +gc.toFixed(2), gs, '', ''] });

  // --- Talonlar: zapchast summalari
  const parts: Record<number, number> = {};
  T('sales').forEach((x) => { if (x.repair_talon) parts[x.repair_talon] = (parts[x.repair_talon] || 0) + Number(x.total_uzs); });
  const tc: XCol[] = [{ h: 'Talon №', t: 'int' }, { h: 'Qabul' }, { h: 'Mijoz', max: 28 }, { h: 'Telefon' }, { h: "Qo'shimcha raqam" }, { h: 'Qurilma', max: 30, wrap: true },
    { h: 'Seriya' }, { h: 'Komplekt', max: 24, wrap: true }, { h: 'Muammo / ish', max: 40, wrap: true }, { h: 'Holati' }, { h: "Servis (so'm)", t: 'uzs' }, { h: "Zapchast (so'm)", t: 'uzs' },
    { h: "Jami (so'm)", t: 'uzs' }, { h: 'Usta' }, { h: 'Qabul qildi' }, { h: 'Topshirildi' }];
  const tr: XRow[] = [];
  const reps = T('repairs').slice().sort((a, b) => b.talon - a.talon);
  const grp: [string, (r: any) => boolean, string][] = [['🔧 Ustaxonada (hali berilmagan)', (r) => r.status !== 'berildi', XC.sec[0]], ['✅ Mijozga topshirilgan', (r) => r.status === 'berildi', XC.sec[1]]];
  for (const [title, f, col] of grp) {
    const list = reps.filter(f); if (!list.length) continue;
    tr.push({ k: 'sec', v: [`${title} — ${list.length} ta`], fill: col });
    let sf = 0, sp = 0;
    for (const r of list) {
      const st = XST[r.status] || [r.status, XC.white], p = parts[r.talon] || 0, fee = Number(r.fee_uzs || 0); sf += fee; sp += p;
      tr.push({ v: [r.talon, xT(r.created_at), r.client_name, r.client_phone, [r.client_phone2, r.client_phone_old && `eski: ${r.client_phone_old}`].filter(Boolean).join('\n'),
        [r.device, r.model].filter(Boolean).join(' · '), r.serial || '', r.accessories || '', r.problem, st[0], fee || '', p || '', fee + p || '', nm(r.master_id), nm(r.accepted_by), xT(r.done_at)],
        cellFill: { 9: st[1] } });
    }
    tr.push({ k: 'sub', v: ['', 'Jami', '', '', '', '', '', '', '', '', sf, sp, sf + sp, '', '', ''] });
  }

  // --- Sotuvlar: kunlar bo'yicha
  const sc: XCol[] = [{ h: 'Chek №', t: 'int' }, { h: 'Vaqt' }, { h: 'Tovar', max: 55, wrap: true }, { h: "Bo'lim" }, { h: 'Soni', t: 'int' }, { h: 'Kelish ($)', t: 'usd' },
    { h: "Tannarx (so'm)", t: 'uzs' }, { h: "Narx (so'm)", t: 'uzs' }, { h: "Summa (so'm)", t: 'uzs' }, { h: "Foyda (so'm)", t: 'uzs' }, { h: "To'lov" }, { h: 'Sotuvchi' }, { h: 'Mijoz' }, { h: 'Talon' }];
  const items = T('sale_items').map((i) => ({ i, x: sales[i.sale_id] })).filter((o) => o.x).sort((a, b) => String(b.x.created_at).localeCompare(String(a.x.created_at)) || b.i.id - a.i.id);
  const sr: XRow[] = []; let cur = '', dq = 0, ds = 0, dp = 0, di = 0, all = 0, allp = 0;
  const flush = () => { if (cur) sr.push({ k: 'sub', v: ['', `${dmy(cur)} jami`, '', '', dq, '', '', '', ds, dp, '', '', '', ''] }); };
  for (const { i, x } of items) {
    const d = xDay(x.created_at);
    if (d !== cur) { flush(); cur = d; dq = ds = dp = 0; sr.push({ k: 'sec', v: [`🛒 ${dmy(d)}`], fill: XC.sec[di++ % 2 ? 1 : 0] }); }
    const c = icost[i.id], cu = c ? Number(c.cost_usd) : 0, tn = c ? Math.round(cu * Number(c.rate) * i.qty) : 0, sum = Number(i.price_uzs) * i.qty, pr = c ? sum - tn : 0;
    dq += i.qty; ds += sum; dp += pr; all += sum; allp += pr;
    const cl = x.client_phone ? `${clients[x.client_phone]?.name || ''} ${x.client_phone}`.trim() : '';
    sr.push({ v: [x.no, xT(x.created_at), i.name, lineName(s, i.line), i.qty, cu || '', tn || '', Number(i.price_uzs), sum, c ? pr : '', PAYN_X[x.pay] || x.pay, nm(x.user_id), cl, x.repair_talon || ''],
      cellFill: x.pay === 'nasiya' ? { 10: 'FFF0D6' } : undefined, font: pr < 0 ? 'CF3556' : undefined });
  }
  flush();
  if (items.length) sr.push({ k: 'tot', v: ['', 'HAMMA SOTUVLAR', '', '', '', '', '', '', all, allp, '', '', '', ''] });

  // --- Mijozlar
  const mc: XCol[] = [{ h: 'Telefon' }, { h: 'Ism', max: 30 }, { h: 'Talonlar', t: 'int' }, { h: 'Oxirgi talon' }, { h: 'Xaridlar', t: 'int' }, { h: "Nasiya qoldig'i (so'm)", t: 'uzs' }, { h: 'Telegram bot' }, { h: "Qo'shilgan" }];
  const mr: XRow[] = T('clients').slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((c) => {
    const rs = T('repairs').filter((r) => r.client_phone === c.phone).sort((a, b) => b.talon - a.talon), bs = T('sales').filter((x) => x.client_phone === c.phone).length;
    const debt = T('customer_debts').filter((d) => d.client_phone === c.phone && !d.closed).reduce((a, d) => a + Number(d.amount_uzs) - Number(d.paid_uzs), 0);
    return { v: [c.phone, c.name, rs.length || '', rs[0] ? `№${rs[0].talon} · ${rs[0].device}${rs[0].model ? ' ' + rs[0].model : ''}` : '', bs || '', debt || '', c.tg_chat_id ? '✅ ulangan' : '', xD(c.created_at)], cellFill: debt > 0 ? { 5: 'FFF0D6' } : undefined };
  });

  // --- Nasiyalar
  const today = day;
  const nc: XCol[] = [{ h: 'Sana' }, { h: 'Mijoz', max: 28 }, { h: 'Telefon' }, { h: "Jami (so'm)", t: 'uzs' }, { h: "To'langan (so'm)", t: 'uzs' }, { h: "Qoldiq (so'm)", t: 'uzs' }, { h: 'Muddat' }, { h: 'Holati' }, { h: 'Izoh', max: 34, wrap: true }];
  const nr: XRow[] = [];
  const nd = T('customer_debts').slice().sort((a, b) => Number(a.closed) - Number(b.closed) || String(b.created_at).localeCompare(String(a.created_at)));
  for (const [title, f, col] of [['💸 Ochiq nasiyalar', (d: any) => !d.closed, XC.sec[2]], ['✔ Yopilgan', (d: any) => d.closed, XC.sec[1]]] as [string, (d: any) => boolean, string][]) {
    const l = nd.filter(f); if (!l.length) continue;
    nr.push({ k: 'sec', v: [`${title} — ${l.length} ta`], fill: col });
    for (const d of l) {
      const left = Number(d.amount_uzs) - Number(d.paid_uzs), late = !d.closed && d.due_date && d.due_date < today;
      nr.push({ v: [xD(d.created_at), d.client_name, d.client_phone, Number(d.amount_uzs), Number(d.paid_uzs) || '', left || '', d.due_date ? dmy(d.due_date) : '', d.closed ? 'Yopildi' : late ? "⚠ Muddati o'tgan" : 'Ochiq', d.note || ''],
        cellFill: late ? { 6: 'FDE4EA', 7: 'FDE4EA' } : undefined });
    }
    nr.push({ k: 'sub', v: ['', 'Jami', '', l.reduce((a, d) => a + Number(d.amount_uzs), 0), l.reduce((a, d) => a + Number(d.paid_uzs), 0), l.reduce((a, d) => a + Number(d.amount_uzs) - Number(d.paid_uzs), 0), '', '', ''] });
  }

  // --- Tovar qarzlari (kimdan olingan bo'yicha)
  const qc: XCol[] = [{ h: 'Sana' }, { h: 'Tovar', max: 45, wrap: true }, { h: 'Soni', t: 'int' }, { h: 'Summa', t: 'uzs' }, { h: 'Valyuta' }, { h: 'Berildi', t: 'uzs' }, { h: 'Qoldiq', t: 'uzs' }, { h: 'Talon' }, { h: 'Holati' }, { h: 'Yozdi' }];
  const qr: XRow[] = [];
  const sups = [...new Set(T('supplier_debts').map((d) => d.supplier))].sort();
  sups.forEach((sp, si) => {
    const l = T('supplier_debts').filter((d) => d.supplier === sp).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const open = l.filter((d) => !d.closed);
    qr.push({ k: 'sec', v: [`🤝 ${sp} — ${l.length} ta yozuv, ${open.length} tasi qarzda`], fill: XC.sec[si % XC.sec.length] });
    for (const d of l) {
      const amt = d.amount == null ? '' : Number(d.amount), left = amt === '' ? '' : Number(amt) - Number(d.paid || 0);
      const st = d.closed ? ['✔ Qarz berilgan', 'D9F5EC'] : d.handed_at ? ['Topshirilgan', 'E3ECFF'] : d.due_date && d.due_date < today ? ["Muddati o'tgan", 'FDE4EA'] : ['Qarzda', 'FFF0D6'];
      qr.push({ v: [xD(d.created_at), d.item_name, d.qty, amt, d.currency === 'usd' ? '$' : "so'm", Number(d.paid || 0) || '', d.closed ? '' : left, d.repair_talon ? `№${d.repair_talon}` : '', st[0], nm(d.user_id)], cellFill: { 8: st[1] } });
    }
  });

  // --- Rasxodlar
  const rc: XCol[] = [{ h: 'Sana' }, { h: 'Turi' }, { h: "Summa (so'm)", t: 'uzs' }, { h: "To'lov" }, { h: 'Kimga' }, { h: 'Izoh', max: 40, wrap: true }, { h: 'Kiritdi' }];
  const rr: XRow[] = []; let mon = '', ms = 0, mi = 0;
  const mflush = () => { if (mon) rr.push({ k: 'sub', v: ['', `${mon} jami`, ms, '', '', '', ''] }); };
  for (const e of T('expenses').slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const m = xDay(e.created_at).slice(0, 7).split('-').reverse().join('.');
    if (m !== mon) { mflush(); mon = m; ms = 0; rr.push({ k: 'sec', v: [`💳 ${m}`], fill: XC.sec[mi++ % 2 ? 4 : 2] }); }
    ms += Number(e.amount_uzs);
    rr.push({ v: [xT(e.created_at), CATS[e.cat] || e.cat, Number(e.amount_uzs), e.pay === 'karta' ? 'Karta' : 'Naqd', nm(e.to_user), e.note || '', nm(e.user_id)] });
  }
  mflush();

  // --- Vazvratlar
  const items2 = Object.fromEntries(T('sale_items').map((i) => [i.id, i]));
  const vc: XCol[] = [{ h: 'Sana' }, { h: 'Chek №', t: 'int' }, { h: 'Tovar', max: 45, wrap: true }, { h: 'Soni', t: 'int' }, { h: "Qaytarildi (so'm)", t: 'uzs' }, { h: 'Sabab', max: 34, wrap: true }, { h: 'Kim' }];
  const vr: XRow[] = T('sale_returns').slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((r) => ({ v: [xT(r.created_at), sales[r.sale_id]?.no || '', items2[r.item_id]?.name || '', r.qty, Number(r.refund_uzs), r.reason || '', nm(r.user_id)] }));

  // --- Xodimlar
  const pay = Object.fromEntries(T('staff_pay').map((p) => [p.user_id, p]));
  const xc: XCol[] = [{ h: 'Ism' }, { h: 'Login' }, { h: 'Lavozim' }, { h: "Oklad (so'm)", t: 'uzs' }, { h: 'KPI %', t: 'int' }, { h: 'KPI asosi' }, { h: 'Holati' }];
  const xr: XRow[] = T('profiles').map((p) => ({ v: [p.name, p.login || '', XROLE[p.role] || p.role, Number(pay[p.id]?.oklad || 0) || '', Number(pay[p.id]?.kpi || 0) || '', pay[p.id]?.kpi_base || '', p.active ? 'Faol' : "O'chirilgan"], font: p.active ? undefined : '9A97B5' }));

  // --- Xulosa
  const y = addDay(day, -1), ys = T('sales').filter((x) => xDay(x.created_at) === y);
  const inShop = T('repairs').filter((r) => r.status !== 'berildi');
  const nOpen = T('customer_debts').filter((d) => !d.closed).reduce((a, d) => a + Number(d.amount_uzs) - Number(d.paid_uzs), 0);
  const qOpen = (cur: string) => T('supplier_debts').filter((d) => !d.closed && d.currency === cur && d.amount != null).reduce((a, d) => a + Number(d.amount) - Number(d.paid || 0), 0);
  const kc: XCol[] = [{ h: "Ko'rsatkich", max: 40 }, { h: 'Qiymat', max: 26 }, { h: 'Izoh', max: 46, wrap: true }];
  const kr: XRow[] = [
    { k: 'sec', v: ['📦 Ombor'], fill: XC.sec[0] },
    { v: ['Tovarlar (bor)', `${gk} xil · ${gq} dona`, `${lines.length} ta bo'lim`] },
    { v: ['Kelish qiymati', `$${gc.toFixed(2)}`, `≈ ${Math.round(gc * rate).toLocaleString('ru-RU')} so'm`] },
    { v: ['Sotish qiymati', `${gs.toLocaleString('ru-RU')} so'm`, gs && gc ? `Kutilayotgan foyda ≈ ${Math.round(gs - gc * rate).toLocaleString('ru-RU')} so'm` : ''] },
    { v: ['Kam qolgan tovarlar', T('products').filter((p) => p.qty > 0 && p.min_qty && p.qty <= p.min_qty).length + ' ta', 'Ombor varag\'ida qizil katak'] },
    { k: 'sec', v: ['🔧 Ustaxona'], fill: XC.sec[1] },
    ...Object.entries(XST).filter(([k]) => k !== 'berildi').map(([k, [t, f]]) => ({ v: [t, `${inShop.filter((r) => r.status === k).length} ta`, ''], cellFill: { 1: f } } as XRow)),
    { v: ['Jami talonlar', `${T('repairs').length} ta`, `Oxirgi talon №${reps[0]?.talon ?? '-'}`] },
    { k: 'sec', v: [`🛒 Kechagi savdo (${dmy(y)})`], fill: XC.sec[2] },
    { v: ['Cheklar', `${ys.length} ta`, ''] },
    { v: ['Tushum', `${ys.reduce((a, x) => a + Number(x.total_uzs), 0).toLocaleString('ru-RU')} so'm`, ''] },
    { k: 'sec', v: ['💰 Qarzlar'], fill: XC.sec[3] },
    { v: ['Mijozlar nasiyasi (ochiq)', `${nOpen.toLocaleString('ru-RU')} so'm`, `${T('customer_debts').filter((d) => !d.closed).length} ta`] },
    { v: ['Tovar qarzlarimiz ($)', `$${qOpen('usd').toFixed(2)}`, ''] },
    { v: ["Tovar qarzlarimiz (so'm)", `${qOpen('uzs').toLocaleString('ru-RU')} so'm`, ''] },
    { k: 'sec', v: ['👥 Baza'], fill: XC.sec[5] },
    { v: ['Mijozlar', `${T('clients').length} ta`, ''] },
    { v: ['Jami sotuvlar', `${T('sales').length} ta chek`, ''] },
    { v: ['Xodimlar', `${T('profiles').filter((p) => p.active).length} ta faol`, ''] },
  ];

  add(xSheet(`${name} — baza zaxirasi`, stamp, kc, kr), 'Xulosa');
  add(xSheet(`${name} — Ombor qoldig'i`, stamp + ' · qizil katak — kam qolgan', oc, or), 'Ombor');
  add(xSheet(`${name} — Ustaxona talonlari`, stamp, tc, tr), 'Talonlar');
  add(xSheet(`${name} — Sotuvlar`, stamp + ' · kunlar bo\'yicha, yangisi tepada', sc, sr), 'Sotuvlar');
  add(xSheet(`${name} — Mijozlar`, stamp, mc, mr), 'Mijozlar');
  add(xSheet(`${name} — Nasiyalar`, stamp, nc, nr), 'Nasiyalar');
  add(xSheet(`${name} — Tovar qarzlari`, stamp + ' · kimdan olingani bo\'yicha', qc, qr), 'Tovar qarzlari');
  add(xSheet(`${name} — Rasxodlar`, stamp + ' · oylar bo\'yicha', rc, rr), 'Rasxodlar');
  add(xSheet(`${name} — Vazvratlar`, stamp, vc, vr), 'Vazvratlar');
  add(xSheet(`${name} — Xodimlar`, stamp, xc, xr), 'Xodimlar');
  return wb;
}

async function sendBackupExcel(s: any, day: string, dump: Record<string, unknown[]>) {
  const wb = buildBackupBook(s, day, dump as Record<string, any[]>);
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
      const pics: string[] = (Array.isArray(p.photos) && p.photos.length ? p.photos : (p.photo ? [p.photo] : [])).filter(Boolean).slice(0, 10);
      const msg = pics.length > 1
        ? (await tg('sendMediaGroup', { chat_id: chat, media: pics.map((u, i) => ({ type: 'photo', media: u, ...(i === 0 ? { caption: caption.slice(0, 1024) } : {}) })) }))?.[0]
        : pics.length
        ? await tg('sendPhoto', { chat_id: chat, photo: pics[0], caption: caption.slice(0, 1024) })
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
