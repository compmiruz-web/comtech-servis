-- Mijozlarga nasiya (qarzga sotish)
alter table profiles add column if not exists can_credit boolean not null default false;
update settings set mods = mods || '{"credit":true}'::jsonb where id = 1 and not (mods ? 'credit');
alter table settings add column if not exists credit jsonb not null default '{"days":30,"limit":0,"remindDays":3}'::jsonb;

alter table sales drop constraint if exists sales_pay_check;
alter table sales add constraint sales_pay_check check (pay in ('naqd','karta','otkazma','nasiya'));
alter table sale_returns add column if not exists to_debt boolean not null default false;
alter table sale_returns add column if not exists cash_uzs numeric;   -- haqiqatda naqd qaytarilgan pul

create table if not exists customer_debts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  sale_id       uuid references sales on delete set null,     -- bo'sh bo'lsa: daftardan kiritilgan eski qarz
  client_phone  text not null references clients on update cascade,
  client_name   text not null,
  amount_uzs    numeric not null check (amount_uzs >= 0),      -- jami qarz
  paid_uzs      numeric not null default 0,                    -- to'langan (oldindan to'lov ham)
  due_date      date,
  note          text,
  user_id       uuid not null default auth.uid() references profiles,
  closed        boolean not null default false,
  last_reminded date
);
create table if not exists customer_payments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  debt_id     uuid not null references customer_debts on delete cascade,
  amount_uzs  numeric not null check (amount_uzs > 0),
  pay         text not null default 'naqd' check (pay in ('naqd','karta','otkazma')),
  user_id     uuid not null default auth.uid() references profiles,
  note        text
);
create index if not exists cdebts_open_idx on customer_debts (closed, due_date);
create index if not exists cdebts_phone_idx on customer_debts (client_phone);
create index if not exists cpay_created_idx on customer_payments (created_at);

alter table customer_debts    enable row level security;
alter table customer_payments enable row level security;

create or replace function can_credit() returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner() or (
    exists (select 1 from profiles where id = auth.uid() and can_credit and active)
    and coalesce((select (mods->>'credit')::boolean from settings where id = 1), true))
$$;

drop policy if exists cdebt_read on customer_debts;
create policy cdebt_read   on customer_debts for select to authenticated using (can_credit());
drop policy if exists cdebt_insert on customer_debts;
create policy cdebt_insert on customer_debts for insert to authenticated
  with check (can_credit() and user_id = auth.uid() and sale_id is null and paid_uzs = 0 and not closed);   -- daftardan eski qarz
drop policy if exists cdebt_update on customer_debts;
create policy cdebt_update on customer_debts for update to authenticated using (can_credit()) with check (can_credit());
drop policy if exists cdebt_delete on customer_debts;
create policy cdebt_delete on customer_debts for delete to authenticated using (is_owner());
drop policy if exists cpay_read on customer_payments;
create policy cpay_read    on customer_payments for select to authenticated using (can_credit());
drop policy if exists cpay_insert on customer_payments;
create policy cpay_insert  on customer_payments for insert to authenticated with check (can_credit() and user_id = auth.uid());
drop policy if exists cpay_delete on customer_payments;
create policy cpay_delete  on customer_payments for delete to authenticated using (is_owner());

-- Xodim qarz summasini o'zi o'zgartira olmaydi (faqat muddat va izoh)
create or replace function cdebt_guard() returns trigger language plpgsql as $$
begin
  if not is_owner() and not is_service() and current_setting('comtech.recalc', true) is distinct from '1' then
    new.amount_uzs := old.amount_uzs; new.paid_uzs := old.paid_uzs; new.client_phone := old.client_phone;
    new.sale_id := old.sale_id; new.user_id := old.user_id; new.created_at := old.created_at;
  end if;
  new.closed := new.paid_uzs >= new.amount_uzs;
  return new;
end $$;
drop trigger if exists cdebt_bu on customer_debts;
create trigger cdebt_bu before update on customer_debts for each row execute function cdebt_guard();

-- To'lovlar yig'indisi qarzga o'zi yoziladi
create or replace function cdebt_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.debt_id, old.debt_id);
begin
  perform set_config('comtech.recalc', '1', true);
  update customer_debts set paid_uzs = coalesce((select sum(amount_uzs) from customer_payments where debt_id = v_id), 0) where id = v_id;
  perform set_config('comtech.recalc', '0', true);
  return null;
end $$;
drop trigger if exists cpay_aiud on customer_payments;
create trigger cpay_aiud after insert or update or delete on customer_payments for each row execute function cdebt_recalc();

-- Sotuv: "nasiya" tanlansa mijoz qarzi ochiladi, chegaradan oshsa rad etiladi
drop function if exists make_sale(jsonb, text, text, date);
create or replace function make_sale(p_items jsonb, p_pay text, p_client text default null, p_date date default null,
  p_client_name text default null, p_due date default null, p_prepaid numeric default 0, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric; v_sale uuid; v_no bigint; v_total numeric := 0; v_ts timestamptz := day_ts(p_date);
  it jsonb; p products%rowtype; v_qty int; v_price numeric; v_item bigint; v_cost numeric;
  v_phone text := nullif(regexp_replace(coalesce(p_client,''), '\s', '', 'g'), ''); v_debt uuid; v_cr jsonb; v_open numeric;
begin
  if not is_staff() then raise exception 'Ruxsat yo''q'; end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then raise exception 'Savat bo''sh'; end if;
  select rate, credit into v_rate, v_cr from settings where id = 1;
  if p_pay = 'nasiya' then
    if not can_credit() then raise exception 'Nasiyaga sotishga ruxsat yo''q'; end if;
    if v_phone is null or coalesce(trim(p_client_name),'') = '' then raise exception 'Nasiya uchun mijozning ismi va telefoni kerak'; end if;
    insert into clients (phone, name) values (v_phone, trim(p_client_name)) on conflict (phone) do update set name = excluded.name;
  elsif v_phone is not null then
    insert into clients (phone, name) values (v_phone, coalesce(nullif(trim(p_client_name),''), v_phone)) on conflict (phone) do nothing;
  end if;

  insert into sales (user_id, pay, total_uzs, rate, client_phone, created_at)
  values (auth.uid(), p_pay, 0, v_rate, v_phone, v_ts)
  returning id, no into v_sale, v_no;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    select * into p from products where id = (it->>'product_id')::uuid for update;
    if not found then raise exception 'Tovar topilmadi'; end if;
    if v_qty < 1 or p.qty < v_qty then raise exception '%: omborda faqat % dona bor', p.name, p.qty; end if;
    v_price := price_uzs(p.sell_usd, v_rate);
    insert into sale_items (sale_id, product_id, name, line, qty, price_uzs)
    values (v_sale, p.id, p.name, p.line, v_qty, v_price) returning id into v_item;
    select cost_usd into v_cost from product_costs where product_id = p.id;
    insert into sale_item_costs (item_id, cost_usd, rate) values (v_item, coalesce(v_cost,0), v_rate);
    update products set qty = qty - v_qty where id = p.id;
    insert into stock_moves (product_id, delta, reason, user_id, ref) values (p.id, -v_qty, 'sotuv', auth.uid(), v_no::text);
    v_total := v_total + v_price * v_qty;
  end loop;
  update sales set total_uzs = v_total where id = v_sale;

  if p_pay = 'nasiya' then
    if coalesce(p_prepaid,0) < 0 or coalesce(p_prepaid,0) >= v_total then raise exception 'Oldindan to''lov jami summadan kam bo''lishi kerak'; end if;
    select coalesce(sum(amount_uzs - paid_uzs),0) into v_open from customer_debts where client_phone = v_phone and not closed;
    if coalesce((v_cr->>'limit')::numeric,0) > 0 and not is_owner()
       and v_open + v_total - coalesce(p_prepaid,0) > (v_cr->>'limit')::numeric then
      raise exception 'Mijozning qarz chegarasi % so''m. Hozirgi qarzi: % so''m', (v_cr->>'limit')::numeric, v_open;
    end if;
    insert into customer_debts (created_at, sale_id, client_phone, client_name, amount_uzs, due_date, note, user_id)
    values (v_ts, v_sale, v_phone, trim(p_client_name), v_total,
            coalesce(p_due, tz_day(v_ts) + coalesce((v_cr->>'days')::int, 30)), nullif(p_note,''), auth.uid())
    returning id into v_debt;
    if coalesce(p_prepaid,0) > 0 then
      insert into customer_payments (created_at, debt_id, amount_uzs, pay, user_id, note) values (v_ts, v_debt, p_prepaid, 'naqd', auth.uid(), 'Oldindan to''lov');
    end if;
  end if;
  return jsonb_build_object('id', v_sale, 'no', v_no, 'total_uzs', v_total, 'debt_id', v_debt);
end $$;

-- Vazvrat: nasiya sotuvida pul qaytarilmaydi, mijoz qarzi kamayadi
create or replace function make_return(p_item bigint, p_qty int, p_reason text default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i sale_items%rowtype; s sales%rowtype; v_back int; v_ts timestamptz := day_ts(p_date); v_id uuid; v_debt boolean := false;
  d customer_debts%rowtype; v_new numeric; v_cash numeric;
begin
  if not can_return() then raise exception 'Vazvrat qilishga ruxsat yo''q'; end if;
  select * into i from sale_items where id = p_item for update;
  if not found then raise exception 'Sotuv topilmadi'; end if;
  select * into s from sales where id = i.sale_id;
  if v_ts < s.created_at - interval '12 hours' then raise exception 'Vazvrat sanasi sotuvdan oldin bo''lishi mumkin emas'; end if;
  select coalesce(sum(qty),0) into v_back from sale_returns where item_id = p_item;
  if p_qty < 1 or p_qty > i.qty - v_back then raise exception 'Qaytarish mumkin: % dona', i.qty - v_back; end if;
  v_cash := i.price_uzs * p_qty;
  select * into d from customer_debts where sale_id = s.id for update;
  if s.pay = 'nasiya' and found then
    v_new := greatest(d.amount_uzs - i.price_uzs * p_qty, 0);
    -- mijoz to'lagan puldan ortig'i naqd qaytariladi
    v_cash := greatest(d.paid_uzs - v_new, 0) - greatest(d.paid_uzs - d.amount_uzs, 0);
    perform set_config('comtech.recalc', '1', true);
    update customer_debts set amount_uzs = v_new where id = d.id;
    perform set_config('comtech.recalc', '0', true);
    v_debt := true;
  end if;
  insert into sale_returns (sale_id, item_id, qty, refund_uzs, user_id, reason, created_at, to_debt, cash_uzs)
  values (s.id, i.id, p_qty, i.price_uzs * p_qty, auth.uid(), nullif(p_reason,''), v_ts, v_debt, v_cash) returning id into v_id;
  if i.product_id is not null then
    update products set qty = qty + p_qty where id = i.product_id;
    insert into stock_moves (product_id, delta, reason, user_id, ref) values (i.product_id, p_qty, 'vazvrat', auth.uid(), s.no::text);
  end if;
  return jsonb_build_object('id', v_id, 'refund_uzs', i.price_uzs * p_qty, 'to_debt', v_debt, 'cash_uzs', v_cash);
end $$;

-- Kunlik xulosa: kassaga nasiya emas, undirilgan to'lov tushadi
create or replace function day_summary(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j jsonb;
begin
  if not (is_owner() or is_service()) then raise exception 'Faqat rahbar'; end if;
  select jsonb_build_object(
    'day', p_day,
    'sales_count', (select count(*) from sales where tz_day(created_at) = p_day),
    'revenue',     (select coalesce(sum(total_uzs),0) from sales where tz_day(created_at) = p_day),
    'by_pay',      (select coalesce(jsonb_object_agg(pay, s),'{}') from (select pay, sum(total_uzs) s from sales where tz_day(created_at) = p_day group by pay) x),
    'sale_cost',   (select coalesce(sum(c.cost_usd * c.rate * i.qty),0) from sale_items i join sales s on s.id = i.sale_id
                    join sale_item_costs c on c.item_id = i.id where tz_day(s.created_at) = p_day),
    'returns',     (select coalesce(sum(refund_uzs),0) from sale_returns where tz_day(created_at) = p_day),
    'returns_cash',(select coalesce(sum(coalesce(cash_uzs, case when to_debt then 0 else refund_uzs end)),0) from sale_returns where tz_day(created_at) = p_day),
    'returns_count',(select count(*) from sale_returns where tz_day(created_at) = p_day),
    'return_cost', (select coalesce(sum(c.cost_usd * c.rate * r.qty),0) from sale_returns r join sale_item_costs c on c.item_id = r.item_id
                    where tz_day(r.created_at) = p_day),
    'credit_sales',(select coalesce(sum(total_uzs),0) from sales where pay = 'nasiya' and tz_day(created_at) = p_day),
    'credit_in',   (select coalesce(sum(amount_uzs),0) from customer_payments where tz_day(created_at) = p_day),
    'credit_open', (select coalesce(sum(amount_uzs - paid_uzs),0) from customer_debts where not closed),
    'credit_overdue_count', (select count(*) from customer_debts where not closed and due_date < tz_day(now())),
    'credit_overdue',(select coalesce(sum(amount_uzs - paid_uzs),0) from customer_debts where not closed and due_date < tz_day(now())),
    'repairs_in',  (select count(*) from repairs where tz_day(created_at) = p_day),
    'repairs_done',(select count(*) from repairs where status = 'berildi' and tz_day(done_at) = p_day),
    'repair_income',(select coalesce(sum(fee_uzs),0) from repairs where status = 'berildi' and tz_day(done_at) = p_day),
    'expenses',    (select coalesce(sum(amount_uzs),0) from expenses where tz_day(created_at) = p_day),
    'exp_count',   (select count(*) from expenses where tz_day(created_at) = p_day),
    'by_cat',      (select coalesce(jsonb_object_agg(cat, s),'{}') from (select cat, sum(amount_uzs) s from expenses where tz_day(created_at) = p_day group by cat) x),
    'rate',        (select rate from settings where id = 1)
  ) into j;
  return j || jsonb_build_object(
    'profit', (j->>'revenue')::numeric - (j->>'sale_cost')::numeric - ((j->>'returns')::numeric - (j->>'return_cost')::numeric),
    'cash',   (j->>'revenue')::numeric - (j->>'credit_sales')::numeric + (j->>'credit_in')::numeric
              - (j->>'returns_cash')::numeric + (j->>'repair_income')::numeric - (j->>'expenses')::numeric);
end $$;

-- Eslatma yuboriladigan qarzlar (server uchun): muddatiga N kun qolgan, bugun yoki o'tgan; har 3 kunda bir marta
create or replace function credit_to_remind() returns setof customer_debts
language sql stable security definer set search_path = public as $$
  select d.* from customer_debts d, settings s
   where s.id = 1 and not d.closed and d.due_date is not null
     and d.due_date <= tz_day(now()) + coalesce((s.credit->>'remindDays')::int, 3)
     and (d.last_reminded is null or d.last_reminded <= tz_day(now()) - 3)
$$;

revoke all on customer_debts, customer_payments from anon;
revoke execute on function make_sale(jsonb,text,text,date,text,date,numeric,text), can_credit(), credit_to_remind() from anon;
revoke execute on function credit_to_remind() from authenticated;
grant execute on function make_sale(jsonb,text,text,date,text,date,numeric,text), can_credit() to authenticated;
grant execute on function credit_to_remind() to service_role;
alter publication supabase_realtime add table customer_debts, customer_payments;
