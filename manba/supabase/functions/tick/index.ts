// Har 5 daqiqada pg_cron chaqiradi.
// 1) reportTime bo'lganda guruhga kunlik hisobot (rasm + matn)
// 2) backupTime bo'lganda kanalga butun baza (JSON fayl)
// 3) "Tayyor" bo'lgan qurilmalar egalariga Telegram/SMS xabar
import { admin, CATS, dmy, env, fmt, json, PAYS, phoneKey, tashkentNow, tg, tgForm } from '../_shared/common.ts';

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
    done.push(`reminded:${await remindCredit(db, s, day)}`);
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
    'repairs', 'sales', 'sale_items', 'sale_item_costs', 'expenses', 'supplier_debts', 'debt_payments', 'sale_returns', 'customer_debts', 'customer_payments'];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) dump[t] = await all(db, t);
  const body = JSON.stringify({ app: 'comtech-servis', version: 1, created: new Date().toISOString(), tables: dump });
  const form = new FormData();
  form.append('chat_id', String(s.tg.channel));
  form.append('caption', `🗄 Baza zaxirasi · ${dmy(day)}\nTovarlar: ${dump.products.length} · Mijozlar: ${dump.clients.length} · Talonlar: ${dump.repairs.length} · Sotuvlar: ${dump.sales.length}`);
  form.append('document', new Blob([body], { type: 'application/json' }), `comtech-baza-${day}.json`);
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
