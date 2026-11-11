-- Tovar qarzlari: kimdan olingani bo'yicha bo'limlar
-- * Summa ixtiyoriy (keyin qo'shish mumkin)
-- * Servis mijozi uchun olingan tovar talonga bog'lanadi; mijoz olib ketganda "Topshirildi"
-- * "Qarzni berish" — bir kishiga bir nechta tovar uchun bitta to'lov; tarix ro'yxati

-- 1) Summa ixtiyoriy
alter table supplier_debts alter column amount drop not null;
alter table supplier_debts drop constraint if exists supplier_debts_amount_check;
alter table supplier_debts add constraint supplier_debts_amount_check check (amount is null or amount > 0);

-- 2) Talon va topshirish
alter table supplier_debts add column if not exists repair_talon int;
alter table supplier_debts add column if not exists handed_at timestamptz;
alter table supplier_debts add column if not exists handed_by uuid references profiles on delete set null;
alter table supplier_debts add column if not exists closed_at timestamptz;
alter table supplier_debts add column if not exists payment_id uuid;
create index if not exists supplier_debts_talon_idx on supplier_debts (repair_talon) where repair_talon is not null;
create index if not exists supplier_debts_sup_idx on supplier_debts (lower(trim(supplier)));
update supplier_debts set closed_at = coalesce(closed_at, created_at) where closed and closed_at is null;

-- 3) Qarzni berish (bir kishiga to'lov)
create table if not exists supplier_payments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid references profiles on delete set null default auth.uid(),
  supplier    text not null,
  amount      numeric check (amount is null or amount > 0),
  currency    text not null default 'usd' check (currency in ('usd', 'uzs')),
  note        text,
  items       jsonb not null default '[]'::jsonb      -- [{id, name, qty}]
);
create index if not exists supplier_payments_sup_idx on supplier_payments (lower(trim(supplier)), created_at);
alter table supplier_payments enable row level security;
grant select on supplier_payments to authenticated;
grant all on supplier_payments to service_role;
do $$ begin alter publication supabase_realtime add table supplier_payments; exception when others then null; end $$;

-- Ruxsati bor xodimlar endi barcha qarzlarni ko'radi (kimdan nima olingani bo'limlarda chiqishi uchun)
drop policy if exists debts_read on supplier_debts;
create policy debts_read on supplier_debts for select to authenticated using (is_owner() or can_add_debt());
drop policy if exists spay_read on supplier_payments;
create policy spay_read on supplier_payments for select to authenticated using (is_owner() or can_add_debt());
drop policy if exists spay_delete on supplier_payments;
create policy spay_delete on supplier_payments for delete to authenticated using (is_owner());
drop policy if exists dpay_owner on debt_payments;
create policy dpay_owner on debt_payments for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists dpay_read on debt_payments;
create policy dpay_read on debt_payments for select to authenticated using (can_add_debt());

-- Eski (har tovarga alohida) to'lovlar summasi noma'lum qarzda xato bermasin
create or replace function debt_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.debt_id, old.debt_id); v_paid numeric;
begin
  v_paid := coalesce((select sum(amount) from debt_payments where debt_id = v_id), 0);
  update supplier_debts d
     set paid = v_paid,
         closed = case when d.payment_id is not null then d.closed else (d.amount is not null and v_paid >= d.amount) end,
         closed_at = case when d.payment_id is not null then d.closed_at
                          when d.amount is not null and v_paid >= d.amount then coalesce(d.closed_at, now()) else null end
   where d.id = v_id;
  return null;
end $$;

-- 4) Qarzga tovar olish (summa ixtiyoriy, talon ixtiyoriy)
create or replace function debt_stock_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric; v_qty int := coalesce((p->>'qty')::int, 0); v_sum numeric := nullif(p->>'amount', '')::numeric;
  v_cur text := coalesce(nullif(p->>'currency', ''), 'usd'); v_bar text := nullif(trim(p->>'barcode'), '');
  v_sell numeric := nullif(p->>'sell', '')::numeric; v_unit_usd numeric; v_pid uuid; v_new boolean; v_debt supplier_debts;
  v_talon int := nullif(regexp_replace(coalesce(p->>'talon', ''), '\D', '', 'g'), '')::int;
begin
  if not can_add_debt() then raise exception 'Qarz kiritishga ruxsat yo''q'; end if;
  if v_qty < 1 then raise exception 'Soni noto''g''ri'; end if;
  if v_sum is not null and v_sum <= 0 then v_sum := null; end if;
  if coalesce(trim(p->>'supplier'), '') = '' or coalesce(trim(p->>'name'), '') = '' then raise exception 'Kimdan va tovar nomini kiriting'; end if;
  if v_talon is not null and not exists (select 1 from repairs where talon = v_talon) then raise exception '№% talon topilmadi', v_talon; end if;
  select rate into v_rate from settings where id = 1;

  if v_bar is not null then
    v_new := not exists (select 1 from products where barcode = v_bar);
    if v_new and v_sell is null then raise exception 'Yangi tovar uchun sotish narxini kiriting'; end if;
    insert into products (name, barcode, line, qty, sell_usd, sell_uzs)
    values (p->>'name', v_bar, coalesce(nullif(p->>'line', ''), 'kompyuter'), v_qty,
            case when v_cur = 'uzs' then coalesce(round(v_sell / nullif(v_rate, 0), 2), 0) else coalesce(v_sell, 0) end,
            case when v_cur = 'uzs' then v_sell end)
    on conflict (barcode) do update
      set qty = products.qty + excluded.qty,
          sell_usd = case when v_sell is null then products.sell_usd else excluded.sell_usd end,
          sell_uzs = case when v_sell is null then products.sell_uzs else excluded.sell_uzs end,
          line = excluded.line
    returning id into v_pid;
    if v_sum is not null then
      v_unit_usd := round(case when v_cur = 'uzs' then v_sum / v_qty / nullif(v_rate, 0) else v_sum / v_qty end, 2);
      insert into product_costs (product_id, cost_usd) values (v_pid, v_unit_usd)
      on conflict (product_id) do update set cost_usd = excluded.cost_usd;
    end if;
    insert into stock_moves (product_id, delta, reason, user_id, ref) values (v_pid, v_qty, 'kirim', auth.uid(), 'qarz');
  end if;

  insert into supplier_debts (user_id, supplier, phone, item_type, item_name, qty, amount, currency, due_date, note, product_id, barcode, repair_talon)
  values (auth.uid(), trim(p->>'supplier'), nullif(trim(p->>'phone'), ''), nullif(p->>'type', ''), trim(p->>'name'), v_qty, v_sum, v_cur,
          nullif(p->>'due', '')::date, nullif(p->>'note', ''), v_pid, v_bar, v_talon)
  returning * into v_debt;
  return jsonb_build_object('debt_id', v_debt.id, 'product_id', v_pid, 'stocked', v_pid is not null);
end $$;

-- 5) Qarz qatorini o'zgartirish: summa (keyin qo'shish), talon, topshirildi
--    Xodim: summasi yo'q qatorga summa qo'yishi, talon bog'lashi, topshirildi belgilashi mumkin; rahbar — hammasi
create or replace function debt_update(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d supplier_debts; v_talon int; v_sum numeric;
begin
  if not can_add_debt() then raise exception 'Ruxsat yo''q'; end if;
  select * into d from supplier_debts where id = p_id for update;
  if not found then raise exception 'Qarz topilmadi'; end if;
  if p ? 'amount' then
    v_sum := nullif(p->>'amount', '')::numeric;
    if v_sum is not null and v_sum <= 0 then raise exception 'Summa noto''g''ri'; end if;
    if d.amount is not null and not is_owner() then raise exception 'Summani faqat rahbar o''zgartiradi'; end if;
    update supplier_debts set amount = v_sum, currency = coalesce(nullif(p->>'currency', ''), currency) where id = p_id;
    if d.product_id is not null and v_sum is not null then
      insert into product_costs (product_id, cost_usd)
      values (d.product_id, round(case when coalesce(nullif(p->>'currency', ''), d.currency) = 'uzs'
                                       then v_sum / d.qty / nullif((select rate from settings where id = 1), 0) else v_sum / d.qty end, 2))
      on conflict (product_id) do update set cost_usd = excluded.cost_usd;
    end if;
  end if;
  if p ? 'talon' then
    v_talon := nullif(regexp_replace(coalesce(p->>'talon', ''), '\D', '', 'g'), '')::int;
    if v_talon is not null and not exists (select 1 from repairs where talon = v_talon) then raise exception '№% talon topilmadi', v_talon; end if;
    update supplier_debts set repair_talon = v_talon,
      handed_at = case when v_talon is not null and (select status from repairs where talon = v_talon) = 'berildi' then coalesce(handed_at, now()) else handed_at end
     where id = p_id;
  end if;
  if p ? 'handed' then
    update supplier_debts set handed_at = case when (p->>'handed')::boolean then coalesce(handed_at, now()) else null end,
                              handed_by = case when (p->>'handed')::boolean then auth.uid() else null end
     where id = p_id;
  end if;
  if is_owner() then
    update supplier_debts set
      supplier  = coalesce(nullif(trim(p->>'supplier'), ''), supplier),
      phone     = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else phone end,
      item_name = coalesce(nullif(trim(p->>'name'), ''), item_name),
      qty       = coalesce(nullif(p->>'qty', '')::int, qty),
      note      = case when p ? 'note' then nullif(p->>'note', '') else note end
     where id = p_id;
  end if;
end $$;

-- 6) Qarzni berish: tanlangan tovarlar "berildi" bo'ladi, to'lov tarixga yoziladi
create or replace function supplier_pay(p_supplier text, p_items uuid[], p_amount numeric default null, p_currency text default 'usd', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_items jsonb;
begin
  if not can_add_debt() then raise exception 'Ruxsat yo''q'; end if;
  if coalesce(trim(p_supplier), '') = '' then raise exception 'Kimga berilayotganini tanlang'; end if;
  if p_amount is not null and p_amount <= 0 then p_amount := null; end if;
  if coalesce(array_length(p_items, 1), 0) = 0 and p_amount is null then raise exception 'Tovarlarni belgilang yoki summani yozing'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', item_name, 'qty', qty, 'amount', amount, 'currency', currency) order by created_at), '[]')
    into v_items from supplier_debts
   where id = any(coalesce(p_items, '{}')) and not closed and lower(trim(supplier)) = lower(trim(p_supplier));
  if coalesce(array_length(p_items, 1), 0) > 0 and jsonb_array_length(v_items) = 0 then raise exception 'Tanlangan tovarlar topilmadi yoki allaqachon berilgan'; end if;
  insert into supplier_payments (user_id, supplier, amount, currency, note, items)
  values (auth.uid(), trim(p_supplier), p_amount, coalesce(nullif(p_currency, ''), 'usd'), nullif(trim(p_note), ''), v_items)
  returning id into v_id;
  update supplier_debts set closed = true, closed_at = now(), payment_id = v_id
   where id = any(coalesce(p_items, '{}')) and not closed and lower(trim(supplier)) = lower(trim(p_supplier));
  return v_id;
end $$;

-- Rahbar to'lovni bekor qilsa, tovarlar yana "ochiq" bo'ladi
create or replace function supplier_pay_undo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  update supplier_debts set closed = false, closed_at = null, payment_id = null where payment_id = p_id;
  delete from supplier_payments where id = p_id;
end $$;

revoke execute on function debt_update(uuid, jsonb), supplier_pay(text, uuid[], numeric, text, text), supplier_pay_undo(uuid) from anon, public;
grant execute on function debt_update(uuid, jsonb), supplier_pay(text, uuid[], numeric, text, text), supplier_pay_undo(uuid) to authenticated;

-- 7) Mijoz qurilmasini olib ketganda (talon "berildi") bog'langan qarz tovari "Topshirildi" bo'ladi
create or replace function repairs_debt_handed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'berildi' and old.status is distinct from 'berildi' then
    update supplier_debts set handed_at = coalesce(handed_at, now()) where repair_talon = new.talon and handed_at is null;
  end if;
  return new;
end $$;
drop trigger if exists repairs_debt_handed_au on repairs;
create trigger repairs_debt_handed_au after update of status on repairs for each row execute function repairs_debt_handed();
