-- 1) Oldingi kun uchun sotuv kiritish  2) Vazvrat (sotilgan tovarni qaytarish)
alter table profiles add column if not exists can_return boolean not null default false;
alter table sales    add column if not exists entered_at timestamptz not null default now();
update settings set mods = mods || '{"returns":true}'::jsonb where id = 1 and not (mods ? 'returns');

create table if not exists sale_returns (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),   -- vazvrat sanasi (oldingi kun bo'lishi mumkin)
  entered_at  timestamptz not null default now(),   -- haqiqatda kiritilgan vaqt
  sale_id     uuid   not null references sales on delete cascade,
  item_id     bigint not null references sale_items on delete cascade,
  qty         int    not null check (qty > 0),
  refund_uzs  numeric not null,
  user_id     uuid   not null default auth.uid() references profiles,
  reason      text
);
create index if not exists returns_created_idx on sale_returns (created_at);
create index if not exists returns_item_idx on sale_returns (item_id);
alter table sale_returns enable row level security;

create or replace function can_return() returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner() or (
    exists (select 1 from profiles where id = auth.uid() and can_return and active)
    and coalesce((select (mods->>'returns')::boolean from settings where id = 1), true))
$$;

-- Vazvrat ruxsati bor xodim boshqalarning sotuvlarini ham ko'radi (qaytarish uchun)
drop policy if exists sales_read on sales;
create policy sales_read on sales for select to authenticated using (is_owner() or user_id = auth.uid() or can_return());
drop policy if exists sale_items_read on sale_items;
create policy sale_items_read on sale_items for select to authenticated using (
  exists (select 1 from sales s where s.id = sale_id and (is_owner() or s.user_id = auth.uid() or can_return())));
drop policy if exists returns_read on sale_returns;
create policy returns_read on sale_returns for select to authenticated using (is_owner() or user_id = auth.uid() or can_return()
  or exists (select 1 from sales s where s.id = sale_id and s.user_id = auth.uid()));

-- Kun -> o'sha kunning 12:00 (Toshkent). Bugun yoki bo'sh bo'lsa hozirgi vaqt.
create or replace function day_ts(p_date date) returns timestamptz
language plpgsql stable as $$
begin
  if p_date is null or p_date >= tz_day(now()) then
    if p_date > tz_day(now()) then raise exception 'Kelajakdagi sanani tanlab bo''lmaydi'; end if;
    return now();
  end if;
  return (p_date + time '12:00') at time zone 'Asia/Tashkent';
end $$;

-- Sotuv (endi sana tanlash mumkin)
drop function if exists make_sale(jsonb, text, text);
create or replace function make_sale(p_items jsonb, p_pay text, p_client text default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric; v_sale uuid; v_no bigint; v_total numeric := 0; v_ts timestamptz := day_ts(p_date);
  it jsonb; p products%rowtype; v_qty int; v_price numeric; v_item bigint; v_cost numeric;
begin
  if not is_staff() then raise exception 'Ruxsat yo''q'; end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then raise exception 'Savat bo''sh'; end if;
  select rate into v_rate from settings where id = 1;

  insert into sales (user_id, pay, total_uzs, rate, client_phone, created_at)
  values (auth.uid(), p_pay, 0, v_rate, nullif(p_client,''), v_ts)
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
  return jsonb_build_object('id', v_sale, 'no', v_no, 'total_uzs', v_total);
end $$;

-- Vazvrat: tovar omborga qaytadi, pul mijozga qaytariladi
create or replace function make_return(p_item bigint, p_qty int, p_reason text default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i sale_items%rowtype; s sales%rowtype; v_back int; v_ts timestamptz := day_ts(p_date); v_id uuid;
begin
  if not can_return() then raise exception 'Vazvrat qilishga ruxsat yo''q'; end if;
  select * into i from sale_items where id = p_item for update;
  if not found then raise exception 'Sotuv topilmadi'; end if;
  select * into s from sales where id = i.sale_id;
  if v_ts < s.created_at - interval '12 hours' then raise exception 'Vazvrat sanasi sotuvdan oldin bo''lishi mumkin emas'; end if;
  select coalesce(sum(qty),0) into v_back from sale_returns where item_id = p_item;
  if p_qty < 1 or p_qty > i.qty - v_back then raise exception 'Qaytarish mumkin: % dona', i.qty - v_back; end if;
  insert into sale_returns (sale_id, item_id, qty, refund_uzs, user_id, reason, created_at)
  values (s.id, i.id, p_qty, i.price_uzs * p_qty, auth.uid(), nullif(p_reason,''), v_ts) returning id into v_id;
  if i.product_id is not null then
    update products set qty = qty + p_qty where id = i.product_id;
    insert into stock_moves (product_id, delta, reason, user_id, ref) values (i.product_id, p_qty, 'vazvrat', auth.uid(), s.no::text);
  end if;
  return jsonb_build_object('id', v_id, 'refund_uzs', i.price_uzs * p_qty);
end $$;

-- Kunlik xulosa: vazvrat tushum va foydadan ayriladi
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
    'returns_count',(select count(*) from sale_returns where tz_day(created_at) = p_day),
    'return_cost', (select coalesce(sum(c.cost_usd * c.rate * r.qty),0) from sale_returns r join sale_item_costs c on c.item_id = r.item_id
                    where tz_day(r.created_at) = p_day),
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
    'cash',   (j->>'revenue')::numeric - (j->>'returns')::numeric + (j->>'repair_income')::numeric - (j->>'expenses')::numeric);
end $$;

-- Oylik: sotuvchi KPI dan o'z sotuvlarining vazvrati ayriladi
create or replace function payroll(p_month text)
returns table (user_id uuid, name text, role text, oklad numeric, kpi numeric, kpi_base text,
               base numeric, kpi_sum numeric, total numeric, paid numeric, left_to_pay numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with u as (
    select pr.id, pr.name, pr.role, coalesce(sp.oklad,0) oklad, coalesce(sp.kpi,0) kpi, coalesce(sp.kpi_base,'foyda') kpi_base
    from profiles pr left join staff_pay sp on sp.user_id = pr.id
    where pr.role <> 'owner' and pr.active
      and (is_owner() or (pr.id = auth.uid() and pr.see_salary
           and coalesce((select (mods->>'salary')::boolean from settings where id = 1), false)))
  ), b as (
    select u.*,
      case when u.role = 'usta' then
        (select coalesce(sum(r.fee_uzs),0) from repairs r where r.master_id = u.id and r.status = 'berildi'
           and to_char(tz_day(r.done_at),'YYYY-MM') = p_month)
      when u.kpi_base = 'tushum' then
        (select coalesce(sum(s.total_uzs),0) from sales s where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month)
        - (select coalesce(sum(r.refund_uzs),0) from sale_returns r join sales s on s.id = r.sale_id
             where s.user_id = u.id and to_char(tz_day(r.created_at),'YYYY-MM') = p_month)
      else
        (select coalesce(sum(i.qty * (i.price_uzs - c.cost_usd * c.rate)),0) from sales s join sale_items i on i.sale_id = s.id
           join sale_item_costs c on c.item_id = i.id where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month)
        - (select coalesce(sum(r.qty * (i.price_uzs - c.cost_usd * c.rate)),0) from sale_returns r join sale_items i on i.id = r.item_id
             join sales s on s.id = r.sale_id join sale_item_costs c on c.item_id = i.id
             where s.user_id = u.id and to_char(tz_day(r.created_at),'YYYY-MM') = p_month)
      end as base,
      (select coalesce(sum(e.amount_uzs),0) from expenses e where e.cat = 'oylik' and e.to_user = u.id
         and to_char(tz_day(e.created_at),'YYYY-MM') = p_month) as paid
    from u
  )
  select b.id, b.name, b.role, b.oklad, b.kpi, b.kpi_base, b.base,
         round(b.base * b.kpi / 100), b.oklad + round(b.base * b.kpi / 100), b.paid,
         b.oklad + round(b.base * b.kpi / 100) - b.paid
  from b order by b.name;
end $$;

revoke all on sale_returns from anon;
revoke execute on function make_sale(jsonb,text,text,date), make_return(bigint,int,text,date), can_return(), day_ts(date) from anon;
grant execute on function make_sale(jsonb,text,text,date), make_return(bigint,int,text,date), can_return() to authenticated;
alter publication supabase_realtime add table sale_returns;
