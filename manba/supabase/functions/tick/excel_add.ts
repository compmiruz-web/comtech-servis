

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
