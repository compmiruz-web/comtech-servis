-- Tovar qarzlari: kimdan qarzga tovar olingan, qancha to'langan
alter table profiles add column if not exists can_debt boolean not null default false;
update settings set mods = mods || '{"debts":true}'::jsonb where id = 1 and not (mods ? 'debts');

create table if not exists supplier_debts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null default auth.uid() references profiles,
  supplier    text not null,                 -- kimdan
  phone       text,
  item_type   text,                          -- tovar turi
  item_name   text not null,                 -- tovar nomi
  qty         int  not null default 1 check (qty > 0),
  amount      numeric not null check (amount > 0),   -- jami summa
  currency    text not null default 'usd' check (currency in ('usd','uzs')),
  due_date    date,
  note        text,
  paid        numeric not null default 0,
  closed      boolean not null default false
);
create table if not exists debt_payments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  debt_id     uuid not null references supplier_debts on delete cascade,
  user_id     uuid not null default auth.uid() references profiles,
  amount      numeric not null check (amount > 0),
  note        text
);
create index if not exists debts_open_idx on supplier_debts (closed, created_at);

alter table supplier_debts enable row level security;
alter table debt_payments  enable row level security;

create or replace function can_add_debt() returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner() or (
    exists (select 1 from profiles where id = auth.uid() and can_debt and active)
    and coalesce((select (mods->>'debts')::boolean from settings where id = 1), true))
$$;

-- Rahbar hammasini ko'radi va boshqaradi; ruxsati bor xodim qo'shadi va o'zi kiritganini ko'radi
drop policy if exists debts_read on supplier_debts;
create policy debts_read   on supplier_debts for select to authenticated using (is_owner() or (user_id = auth.uid() and can_add_debt()));
drop policy if exists debts_insert on supplier_debts;
create policy debts_insert on supplier_debts for insert to authenticated with check (user_id = auth.uid() and can_add_debt() and paid = 0 and not closed);
drop policy if exists debts_update on supplier_debts;
create policy debts_update on supplier_debts for update to authenticated using (is_owner()) with check (is_owner());
drop policy if exists debts_delete on supplier_debts;
create policy debts_delete on supplier_debts for delete to authenticated using (is_owner());
drop policy if exists dpay_owner on debt_payments;
create policy dpay_owner   on debt_payments for all to authenticated using (is_owner()) with check (is_owner());

-- To'lov qo'shilsa yoki o'chirilsa, qarzning to'langan summasi o'zi yangilanadi
create or replace function debt_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.debt_id, old.debt_id);
begin
  update supplier_debts d
     set paid = coalesce((select sum(amount) from debt_payments where debt_id = v_id), 0),
         closed = coalesce((select sum(amount) from debt_payments where debt_id = v_id), 0) >= d.amount
   where d.id = v_id;
  return null;
end $$;
drop trigger if exists debt_payments_aiud on debt_payments;
create trigger debt_payments_aiud after insert or update or delete on debt_payments
  for each row execute function debt_recalc();

grant execute on function can_add_debt() to authenticated;
alter publication supabase_realtime add table supplier_debts, debt_payments;
