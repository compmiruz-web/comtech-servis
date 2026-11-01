// admin-users
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
// Umumiy yordamchilar: Telegram, Supabase (service), vaqt, formatlash

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

// Xodimlarni boshqarish (faqat rahbar): qo'shish, PIN almashtirish, o'chirish/yoqish.
// Xodim tizimga "login + PIN" bilan kiradi: login@comtech.app / PIN (kamida 6 raqam).

const DOMAIN = 'comtech.app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization') || '';
  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } });
  const { data: me } = await caller.auth.getUser();
  if (!me?.user) return json({ error: 'Tizimga kiring' }, 401);
  const db = admin();
  const { data: prof } = await db.from('profiles').select('role,active').eq('id', me.user.id).single();
  if (prof?.role !== 'owner' || !prof.active) return json({ error: 'Faqat rahbar' }, 403);

  const b = await req.json();
  const pinOk = (p: string) => /^\d{6,12}$/.test(p || '');
  try {
    if (b.action === 'create') {
      const login = String(b.login || '').toLowerCase().trim();
      if (!/^[a-z0-9_.]{3,20}$/.test(login)) return json({ error: "Login 3-20 ta lotin harf yoki raqam bo'lsin" }, 400);
      if (!['usta', 'sotuvchi'].includes(b.role)) return json({ error: "Lavozim noto'g'ri" }, 400);
      if (!pinOk(b.pin)) return json({ error: "PIN 6 tadan 12 tagacha raqam bo'lsin" }, 400);
      const { data: u, error } = await db.auth.admin.createUser({ email: `${login}@${DOMAIN}`, password: b.pin, email_confirm: true });
      if (error) return json({ error: error.message.includes('already') ? 'Bu login band' : error.message }, 400);
      const { error: e2 } = await db.from('profiles').insert({
        id: u.user.id, name: b.name, login, role: b.role, can_expense: !!b.can_expense, see_salary: !!b.see_salary,
      });
      if (e2) { await db.auth.admin.deleteUser(u.user.id); return json({ error: e2.message }, 400); }
      await db.from('staff_pay').insert({ user_id: u.user.id, oklad: b.oklad || 0, kpi: b.kpi || 0 });
      return json({ ok: true, id: u.user.id });
    }
    if (b.action === 'set_pin') {
      if (!pinOk(b.pin)) return json({ error: "PIN 6 tadan 12 tagacha raqam bo'lsin" }, 400);
      const { error } = await db.auth.admin.updateUserById(b.user_id, { password: b.pin });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    if (b.action === 'set_active') {
      if (b.user_id === me.user.id) return json({ error: "O'zingizni o'chira olmaysiz" }, 400);
      await db.from('profiles').update({ active: !!b.active }).eq('id', b.user_id);
      await db.auth.admin.updateUserById(b.user_id, { ban_duration: b.active ? 'none' : '876000h' });
      return json({ ok: true });
    }
    return json({ error: "Noma'lum amal" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
