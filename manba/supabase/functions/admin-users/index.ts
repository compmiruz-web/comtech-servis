// Xodimlarni boshqarish (faqat rahbar): qo'shish, PIN almashtirish, o'chirish/yoqish.
// Xodim tizimga "login + PIN" bilan kiradi: login@comtech.app / PIN (kamida 6 raqam).
import { admin, cors, json } from '../_shared/common.ts';

const DOMAIN = 'comtech.app';
const normLogin = (l: string) => String(l || '').trim().toLowerCase();
function loginToEmail(l: string) {
  l = normLogin(l);
  if (/^[a-z0-9._-]{1,40}$/.test(l)) return `${l}@${DOMAIN}`;
  return 'x' + [...new TextEncoder().encode(l)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 60) + '@' + DOMAIN;
}
// Ilova bilan bir xil: qisqa PIN Supabase uchun uzaytiriladi
const pinPw = (pin: string) => `ct#${String(pin).trim()}#pin`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const db = admin();
  const { data: me } = token ? await db.auth.getUser(token) : { data: null };
  if (!me?.user) return json({ error: 'Tizimga kiring' }, 401);
  const { data: prof } = await db.from('profiles').select('role,active').eq('id', me.user.id).single();
  if (prof?.role !== 'owner' || !prof.active) return json({ error: 'Faqat rahbar' }, 403);

  const b = await req.json();
  const pinOk = (p: string) => /^\d{1,12}$/.test(String(p || '').trim());
  const loginOk = (l: string) => normLogin(l).length >= 1 && normLogin(l).length <= 30;
  try {
    if (b.action === 'create') {
      const login = normLogin(b.login);
      if (!loginOk(login)) return json({ error: "Login 1-30 belgi bo'lsin" }, 400);
      if (!['usta', 'sotuvchi'].includes(b.role)) return json({ error: "Lavozim noto'g'ri" }, 400);
      if (!pinOk(b.pin)) return json({ error: "PIN faqat raqam bo'lsin (1-12 ta)" }, 400);
      const { data: u, error } = await db.auth.admin.createUser({ email: loginToEmail(login), password: pinPw(b.pin), email_confirm: true });
      if (error) return json({ error: error.message.includes('already') ? 'Bu login band' : error.message }, 400);
      const { error: e2 } = await db.from('profiles').insert({
        id: u.user.id, name: b.name, login, role: b.role, can_expense: !!b.can_expense, see_salary: !!b.see_salary,
      });
      if (e2) { await db.auth.admin.deleteUser(u.user.id); return json({ error: e2.message }, 400); }
      await db.from('staff_pay').insert({ user_id: u.user.id, oklad: b.oklad || 0, kpi: b.kpi || 0 });
      return json({ ok: true, id: u.user.id });
    }
    if (b.action === 'update') {
      const patch: Record<string, unknown> = {};
      const prof: Record<string, unknown> = {};
      if (b.name && String(b.name).trim()) prof.name = String(b.name).trim();
      if (b.login !== undefined && b.login !== '') {
        const login = normLogin(b.login);
        if (!loginOk(login)) return json({ error: "Login 1-30 belgi bo'lsin" }, 400);
        const { data: taken } = await db.from('profiles').select('id').eq('login', login).neq('id', b.user_id).maybeSingle();
        if (taken) return json({ error: 'Bu login band' }, 400);
        prof.login = login; patch.email = loginToEmail(login); patch.email_confirm = true;
      }
      if (b.pin !== undefined && String(b.pin).trim() !== '') {
        if (!pinOk(b.pin)) return json({ error: "PIN faqat raqam bo'lsin (1-12 ta)" }, 400);
        patch.password = pinPw(b.pin);
      }
      if (Object.keys(patch).length) {
        const { error } = await db.auth.admin.updateUserById(b.user_id, patch);
        if (error) return json({ error: error.message.includes('already') ? 'Bu login band' : error.message }, 400);
      }
      if (Object.keys(prof).length) {
        const { error } = await db.from('profiles').update(prof).eq('id', b.user_id);
        if (error) return json({ error: error.message }, 400);
      }
      return json({ ok: true });
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
