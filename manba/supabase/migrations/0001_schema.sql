-- COM-TECH Servis: baza sxemasi
-- Supabase SQL Editor'da bir marta ishga tushiriladi.
-- Vaqt zonasi: Asia/Tashkent (barcha "kun" hisoblari shu bo'yicha)

create extension if not exists pgcrypto;

-------------------------------------------------------------------------------
-- 1. Jadvallar
-------------------------------------------------------------------------------

-- Umumiy sozlamalar (bitta qator)
create table if not exists settings (
  id          int primary key default 1 check (id = 1),
  company     jsonb not null default '{
    "name":"COM-TECH","sub":"Kompyuter servis va savdo",
    "lines":{
      "servis":   {"phone":"97-210-05-15","telegram":"@compmir","instagram":"@compmir"},
      "noutbuk":  {"phone":"97-210-05-15","telegram":"@noutbuk_savdo","instagram":"@noutbuk.savdo"},
      "kompyuter":{"phone":"97-210-05-15","telegram":"@kompyuterxon","instagram":"@kompyuter.uz"}
    },
    "labelPrice":false}'::jsonb,
  rate        numeric not null default 12850,
  rate_date   date    not null default (now() at time zone 'Asia/Tashkent')::date,
  next_talon  int     not null default 1,
  mods        jsonb   not null default '{"expenses":true,"salary":true}'::jsonb,
  tg          jsonb   not null default '{"group":"-4993928009","channel":"-1005453553679","reportTime":"21:00","backupTime":"00:00","profit":false}'::jsonb,
  printers    jsonb   not null default '{"receipt":"WP230","receiptW":"80","label":"XP-365B","labelW":58,"labelH":40,"stkW":58,"stkH":40}'::jsonb,
  last_report date,
  last_backup date,
  updated_at  timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

-- Xodimlar (auth.users bilan bog'langan)
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null,
  login       text unique,
  role        text not null check (role in ('owner','usta','sotuvchi')),
  can_expense boolean not null default false,
  see_salary  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Oylik sozlamalari (faqat rahbar)
create table if not exists staff_pay (
  user_id   uuid primary key references profiles on delete cascade,
  oklad     numeric not null default 0,
  kpi       numeric not null default 0 check (kpi between 0 and 100),
  kpi_base  text    not null default 'foyda' check (kpi_base in ('foyda','tushum'))
);

-- Tovarlar (hamma ko'radi, kelish narxi alohida jadvalda)
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  barcode     text not null unique,
  line        text not null default 'kompyuter' check (line in ('servis','noutbuk','kompyuter')),
  qty         int  not null default 0 check (qty >= 0),
  sell_usd    numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Kelish narxi: faqat rahbar
create table if not exists product_costs (
  product_id  uuid primary key references products on delete cascade,
  cost_usd    numeric not null default 0
);

-- Ombor harakati tarixi (kirim/chiqim)
create table if not exists stock_moves (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  product_id  uuid references products on delete set null,
  delta       int not null,
  reason      text not null,            -- 'kirim' | 'sotuv' | 'tuzatish'
  user_id     uuid references profiles,
  ref         text
);

-- Mijozlar
create table if not exists clients (
  phone       text primary key,
  name        text not null,
  tg_chat_id  bigint,                   -- mijoz botga /start bosib raqamini ulasa
  created_at  timestamptz not null default now()
);

-- Remontlar
create table if not exists repairs (
  talon        int primary key,
  created_at   timestamptz not null default now(),
  client_phone text not null references clients on update cascade,
  client_name  text not null,
  device       text not null,
  model        text,
  serial       text,
  problem      text not null,
  accessories  text,
  status       text not null default 'qabul' check (status in ('qabul','diag','tamir','tayyor','berildi')),
  fee_uzs      numeric not null default 0,
  master_id    uuid references profiles,
  accepted_by  uuid references profiles,
  done_at      timestamptz,
  notified_at  timestamptz
);

-- Sotuvlar
create table if not exists sales (
  id           uuid primary key default gen_random_uuid(),
  no           bigserial unique,
  created_at   timestamptz not null default now(),
  user_id      uuid not null references profiles,
  pay          text not null check (pay in ('naqd','karta','otkazma')),
  total_uzs    numeric not null,
  rate         numeric not null,
  client_phone text references clients on update cascade
);
create table if not exists sale_items (
  id          bigserial primary key,
  sale_id     uuid not null references sales on delete cascade,
  product_id  uuid references products on delete set null,
  name        text not null,
  line        text not null,
  qty         int  not null check (qty > 0),
  price_uzs   numeric not null
);
-- Sotuv vaqtidagi tannarx: faqat rahbar
create table if not exists sale_item_costs (
  item_id     bigint primary key references sale_items on delete cascade,
  cost_usd    numeric not null,
  rate        numeric not null
);

-- Rasxodlar
create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null default auth.uid() references profiles,
  cat         text not null check (cat in ('qism','transport','ovqat','kommunal','ijara','oylik','boshqa')),
  amount_uzs  numeric not null check (amount_uzs > 0),
  note        text,
  to_user     uuid references profiles
);

create index if not exists sales_created_idx    on sales (created_at);
create index if not exists expenses_created_idx on expenses (created_at);
create index if not exists repairs_status_idx   on repairs (status);
create index if not exists repairs_phone_idx    on repairs (client_phone);

-------------------------------------------------------------------------------
-- 2. Yordamchi funksiyalar
-------------------------------------------------------------------------------

create or replace function tz_day(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'Asia/Tashkent')::date $$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'owner' and active)
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;

create or replace function is_service() returns boolean
language sql stable as $$ select coalesce(auth.role(), '') = 'service_role' $$;

-- Birinchi kirgan foydalanuvchi rahbar bo'ladi (faqat rahbar hali yo'q bo'lsa)
create or replace function claim_owner(p_name text default 'Rahbar') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from profiles where role = 'owner') then return false; end if;
  insert into profiles (id, name, role, login, can_expense, see_salary)
  values (auth.uid(), p_name, 'owner', 'rahbar', true, true)
  on conflict (id) do update set role = 'owner';
  return true;
end $$;

-- Narxni so'mga aylantirish (1000 ga yaxlitlab yuqoriga)
create or replace function price_uzs(p_usd numeric, p_rate numeric) returns numeric
language sql immutable as $$ select ceil(p_usd * p_rate / 1000.0) * 1000 $$;

-------------------------------------------------------------------------------
-- 3. Xavfsizlik (RLS)
-------------------------------------------------------------------------------

alter table settings        enable row level security;
alter table profiles        enable row level security;
alter table staff_pay       enable row level security;
alter table products        enable row level security;
alter table product_costs   enable row level security;
alter table stock_moves     enable row level security;
alter table clients         enable row level security;
alter table repairs         enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table sale_item_costs enable row level security;
alter table expenses        enable row level security;

-- settings: hamma o'qiydi, rahbar o'zgartiradi
create policy settings_read  on settings for select to authenticated using (is_staff());
create policy settings_write on settings for update to authenticated using (is_owner()) with check (is_owner());

-- profiles: hamma ismlarni ko'radi, rahbar boshqaradi
create policy profiles_read  on profiles for select to authenticated using (is_staff() or id = auth.uid());
create policy profiles_write on profiles for all    to authenticated using (is_owner()) with check (is_owner());

-- staff_pay: rahbar; xodim o'zinikini faqat ruxsat bo'lsa
create policy pay_owner on staff_pay for all to authenticated using (is_owner()) with check (is_owner());
create policy pay_self  on staff_pay for select to authenticated using (
  user_id = auth.uid()
  and exists (select 1 from profiles where id = auth.uid() and see_salary)
  and coalesce((select (mods->>'salary')::boolean from settings where id = 1), false));

-- products: hamma o'qiydi, rahbar yozadi (sotuvda qoldiq make_sale orqali kamayadi)
create policy products_read  on products for select to authenticated using (is_staff());
create policy products_write on products for all    to authenticated using (is_owner()) with check (is_owner());

-- kelish narxlari va tannarx: faqat rahbar
create policy costs_owner      on product_costs   for all    to authenticated using (is_owner()) with check (is_owner());
create policy sale_costs_owner on sale_item_costs for select to authenticated using (is_owner());
create policy moves_owner      on stock_moves     for select to authenticated using (is_owner());

-- mijozlar: hamma xodim
create policy clients_rw on clients for all to authenticated using (is_staff()) with check (is_staff());

-- remontlar: hamma o'qiydi va holat/narxni o'zgartiradi; qo'shish intake_repair orqali; o'chirish rahbar
create policy repairs_read   on repairs for select to authenticated using (is_staff());
create policy repairs_update on repairs for update to authenticated using (is_staff()) with check (is_staff());
create policy repairs_delete on repairs for delete to authenticated using (is_owner());

-- sotuvlar: rahbar hammasini, xodim o'zinikini ko'radi; qo'shish make_sale orqali
create policy sales_read on sales for select to authenticated using (is_owner() or user_id = auth.uid());
create policy sale_items_read on sale_items for select to authenticated using (
  exists (select 1 from sales s where s.id = sale_id and (is_owner() or s.user_id = auth.uid())));

-- rasxodlar
create policy exp_read on expenses for select to authenticated using (is_owner() or user_id = auth.uid());
create policy exp_insert on expenses for insert to authenticated with check (
  user_id = auth.uid() and (
    is_owner() or (
      cat <> 'oylik' and to_user is null
      and exists (select 1 from profiles where id = auth.uid() and can_expense and active)
      and coalesce((select (mods->>'expenses')::boolean from settings where id = 1), false))));
create policy exp_delete on expenses for delete to authenticated using (is_owner());

-------------------------------------------------------------------------------
-- 4. Triggerlar
-------------------------------------------------------------------------------

create or replace function repairs_before_update() returns trigger
language plpgsql as $$
begin
  if new.status = 'berildi' and old.status <> 'berildi' then new.done_at := now(); end if;
  if new.status <> 'berildi' then new.done_at := null; end if;
  -- xodim faqat holat, narx va ustani o'zgartira oladi
  if not is_owner() and not is_service() then
    new.talon := old.talon; new.created_at := old.created_at; new.client_phone := old.client_phone;
    new.accepted_by := old.accepted_by;
  end if;
  return new;
end $$;
drop trigger if exists repairs_bu on repairs;
create trigger repairs_bu before update on repairs for each row execute function repairs_before_update();

create or replace function touch_updated() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists products_touch on products;
create trigger products_touch before update on products for each row execute function touch_updated();
drop trigger if exists settings_touch on settings;
create trigger settings_touch before update on settings for each row execute function touch_updated();

-------------------------------------------------------------------------------
-- 5. Server funksiyalari (RPC)
-------------------------------------------------------------------------------

-- Sotuv: narx serverda hisoblanadi, qoldiq tekshiriladi va kamayadi
create or replace function make_sale(p_items jsonb, p_pay text, p_client text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric; v_sale uuid; v_no bigint; v_total numeric := 0;
  it jsonb; p products%rowtype; v_qty int; v_price numeric; v_item bigint; v_cost numeric;
begin
  if not is_staff() then raise exception 'Ruxsat yo''q'; end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then raise exception 'Savat bo''sh'; end if;
  select rate into v_rate from settings where id = 1;

  insert into sales (user_id, pay, total_uzs, rate, client_phone)
  values (auth.uid(), p_pay, 0, v_rate, nullif(p_client,''))
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

-- Kirim (faqat rahbar): bor shtrix-kod bo'lsa soni qo'shiladi
create or replace function stock_in(p_barcode text, p_name text, p_line text, p_qty int, p_cost numeric, p_sell numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  insert into products (name, barcode, line, qty, sell_usd)
  values (p_name, p_barcode, p_line, p_qty, p_sell)
  on conflict (barcode) do update
    set qty = products.qty + excluded.qty, sell_usd = excluded.sell_usd, line = excluded.line,
        name = coalesce(nullif(excluded.name,''), products.name)
  returning id into v_id;
  insert into product_costs (product_id, cost_usd) values (v_id, p_cost)
  on conflict (product_id) do update set cost_usd = excluded.cost_usd;
  insert into stock_moves (product_id, delta, reason, user_id) values (v_id, p_qty, 'kirim', auth.uid());
  return v_id;
end $$;

-- Remont qabul qilish: talon raqami atomik beriladi
create or replace function intake_repair(p jsonb) returns repairs
language plpgsql security definer set search_path = public as $$
declare v_talon int; r repairs;
begin
  if not is_staff() then raise exception 'Ruxsat yo''q'; end if;
  update settings set next_talon = next_talon + 1 where id = 1 returning next_talon - 1 into v_talon;
  insert into clients (phone, name) values (p->>'phone', p->>'name')
  on conflict (phone) do update set name = excluded.name;
  insert into repairs (talon, client_phone, client_name, device, model, serial, problem, accessories, fee_uzs, master_id, accepted_by)
  values (v_talon, p->>'phone', p->>'name', p->>'device', p->>'model', p->>'serial', p->>'problem', p->>'accessories',
          coalesce((p->>'fee_uzs')::numeric, 0), nullif(p->>'master_id','')::uuid, auth.uid())
  returning * into r;
  return r;
end $$;

-- Kunlik xulosa (rahbar yoki server)
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
    'repairs_in',  (select count(*) from repairs where tz_day(created_at) = p_day),
    'repairs_done',(select count(*) from repairs where status = 'berildi' and tz_day(done_at) = p_day),
    'repair_income',(select coalesce(sum(fee_uzs),0) from repairs where status = 'berildi' and tz_day(done_at) = p_day),
    'expenses',    (select coalesce(sum(amount_uzs),0) from expenses where tz_day(created_at) = p_day),
    'exp_count',   (select count(*) from expenses where tz_day(created_at) = p_day),
    'by_cat',      (select coalesce(jsonb_object_agg(cat, s),'{}') from (select cat, sum(amount_uzs) s from expenses where tz_day(created_at) = p_day group by cat) x),
    'rate',        (select rate from settings where id = 1)
  ) into j;
  return j || jsonb_build_object(
    'profit', (j->>'revenue')::numeric - (j->>'sale_cost')::numeric,
    'cash',   (j->>'revenue')::numeric + (j->>'repair_income')::numeric - (j->>'expenses')::numeric);
end $$;

-- Oylik hisobi: rahbar hammani, xodim (ruxsat bo'lsa) o'zini ko'radi. p_month: '2026-11'
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
      else
        (select coalesce(sum(i.qty * (i.price_uzs - c.cost_usd * c.rate)),0) from sales s join sale_items i on i.sale_id = s.id
           join sale_item_costs c on c.item_id = i.id where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month)
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

-- Ruxsatlar: anonim foydalanuvchiga hech narsa
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
grant execute on function make_sale(jsonb,text,text), stock_in(text,text,text,int,numeric,numeric),
  intake_repair(jsonb), day_summary(date), payroll(text), claim_owner(text) to authenticated;

-- Jonli yangilanish (bir qurilmada kiritilsa, boshqasida darhol ko'rinadi)
alter publication supabase_realtime add table products, repairs, sales, expenses, settings, profiles, clients;
