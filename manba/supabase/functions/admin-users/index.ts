// Xodimlarni boshqarish (faqat rahbar): qo'shish, PIN almashtirish, o'chirish/yoqish.
// Xodim tizimga "login + PIN" bilan kiradi: login@comtech.app / PIN (kamida 6 raqam).
import { admin, cors, json } from '../_shared/common.ts';

const DOMAIN = 'comtech.app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const db = admin();
  const { data: me } = token ? await db.auth.getUser(token) : { data: null };
  if (!me?.user) return json({ error: 'Tizimga kiring' }, 401);
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
