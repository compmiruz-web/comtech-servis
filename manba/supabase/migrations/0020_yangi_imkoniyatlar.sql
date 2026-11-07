-- 6 ta yangi imkoniyat:
-- 1) Mijoz boti: talon raqami bo'yicha holat, "Olib ketaman" tugmasi
-- 2) Kam qolgan tovar ogohlantirishi (Telegram + dastur)
-- 3) Haftalik / oylik tahlil
-- 4) Kafolat bazasi (shtrix-kod yoki seriya bo'yicha)
-- 5) Yangi tovarlarni Telegram kanallarga chiqarish (rasm + narx)
-- 6) Mecanuz avtomatlari tushumi

-------------------------------------------------------------------------------
-- Sozlamalar
-------------------------------------------------------------------------------
alter table settings add column if not exists features jsonb not null default '{
  "lowStock": true, "minQty": {"kompyuter": 2},
  "weekly": true, "monthly": true,
  "autoPost": false, "channels": {"noutbuk": "@noutbuk_savdo", "kompyuter": "@kompyuterxon"},
  "warranty": {"noutbuk": {"n": 12, "u": "oy"}, "kompyuter": {"n": 12, "u": "oy"}, "servis": {"n": 1, "u": "oy"}}
}'::jsonb;
alter table settings add column if not exists last_weekly date;
alter table settings add column if not exists last_monthly text;
-- bot yangi tugmalarni (callback) qabul qilishi uchun webhook qayta ulanadi
alter table settings add column if not exists webhook_ok boolean not null default false;
update settings set webhook_ok = false where id = 1;

-------------------------------------------------------------------------------
-- Tovar: kafolat, rasm, kam qoldiq chegarasi
-------------------------------------------------------------------------------
alter table products add column if not exists warranty jsonb;          -- {"n":12,"u":"oy"}
alter table products add column if not exists photo text;              -- rasm manzili (Storage)
alter table products add column if not exists min_qty int;             -- shundan kam qolsa ogohlantirish (0 — hech qachon)
alter table products add column if not exists low_alerted_at timestamptz;
alter table sale_items add column if not exists warranty jsonb;        -- sotilgan paytdagi kafolat
alter table repairs add column if not exists pickup_at timestamptz;    -- mijoz botda "Olib ketaman" bosgan vaqt

-- Kam qoldiq chegarasi: tovarning o'zida bo'lsa o'sha, bo'lmasa bo'lim bo'yicha (sozlamalarda)
create or replace function low_thr(p products) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(p.min_qty, (select (features->'minQty'->>p.line)::int from settings where id = 1), 0)
$$;
-- Hozir kam bo'lganlar uchun eski ro'yxat birdaniga yuborilmasin
update products p set low_alerted_at = now() where low_alerted_at is null and p.qty < low_thr(p);

-- Sotilgan tovarga kafolat muddati yoziladi (tovarniki, bo'lmasa bo'lim bo'yicha)
create or replace function sale_items_warranty() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.warranty is null then
    select coalesce(p.warranty, (select features->'warranty'->new.line from settings where id = 1))
      into new.warranty from products p where p.id = new.product_id;
    if new.warranty is null then new.warranty := (select features->'warranty'->new.line from settings where id = 1); end if;
  end if;
  return new;
end $$;
drop trigger if exists sale_items_warranty_bi on sale_items;
create trigger sale_items_warranty_bi before insert on sale_items for each row execute function sale_items_warranty();

-- Holat o'zgarsa "Olib ketaman" belgisi tozalanadi
create or replace function repairs_pickup_reset() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status <> 'tayyor' then new.pickup_at := null; end if;
  return new;
end $$;
drop trigger if exists repairs_pickup_reset_bu on repairs;
create trigger repairs_pickup_reset_bu before update on repairs for each row execute function repairs_pickup_reset();

-- Tovarning qo'shimcha ma'lumotlari: kafolat, rasm, chegara (rahbar yoki kirim ruxsati bor xodim)
create or replace function product_set_extra(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_stock() then raise exception 'Ruxsat yo''q'; end if;
  update products set
    warranty = case when p ? 'warranty' then nullif(p->'warranty', 'null'::jsonb) else warranty end,
    photo    = case when p ? 'photo' then nullif(p->>'photo', '') else photo end,
    min_qty  = case when p ? 'min_qty' then nullif(p->>'min_qty', '')::int else min_qty end
  where id = p_id;
  if not found then raise exception 'Tovar topilmadi'; end if;
end $$;
revoke execute on function product_set_extra(uuid, jsonb) from anon, public;
grant execute on function product_set_extra(uuid, jsonb) to authenticated;

-------------------------------------------------------------------------------
-- 2) Kam qoldiq tekshiruvi (server har 5 daqiqada chaqiradi)
-------------------------------------------------------------------------------
create or replace function low_stock_check() returns jsonb
language plpgsql security definer set search_path = public as $$
declare f jsonb; r jsonb;
begin
  select features into f from settings where id = 1;
  -- yana ko'paygan tovarlar: keyingi safar kamaysa yana xabar beriladi
  update products p set low_alerted_at = null where low_alerted_at is not null and p.qty >= low_thr(p);
  if coalesce((f->>'lowStock')::boolean, true) = false then return '[]'::jsonb; end if;
  with x as (
    update products p set low_alerted_at = now()
     where low_alerted_at is null and p.qty < low_thr(p)
    returning p.name, p.barcode, p.line, p.qty, low_thr(p) thr)
  select coalesce(jsonb_agg(to_jsonb(x) order by x.qty, x.name), '[]'::jsonb) into r from x;
  if jsonb_array_length(r) > 0 then
    insert into notifications (kind, level, title, body)
    values ('stock', 'bad', jsonb_array_length(r) || ' ta tovar kam qoldi — buyurtma qilish kerak',
      (select string_agg('• ' || (e->>'name') || ' — ' || (e->>'qty') || ' dona', E'\n') from jsonb_array_elements(r) e));
  end if;
  return r;
end $$;
revoke execute on function low_stock_check() from anon, authenticated, public;
grant execute on function low_stock_check() to service_role;

-------------------------------------------------------------------------------
-- 3) Tahlil: davr bo'yicha eng ko'p sotilgan, bo'limlar, sotuvchilar, ustalar, kunlar
-------------------------------------------------------------------------------
create or replace function analytics(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j jsonb;
begin
  if not (is_owner() or is_service()) then raise exception 'Faqat rahbar'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Davr noto''g''ri'; end if;
  with it as (
    select i.id, i.sale_id, i.name, i.line, i.price_uzs, s.user_id, tz_day(s.created_at) d,
           coalesce(c.cost_usd * c.rate, 0) unit_cost,
           i.qty - coalesce((select sum(r.qty) from sale_returns r where r.item_id = i.id), 0) nq
      from sale_items i join sales s on s.id = i.sale_id left join sale_item_costs c on c.item_id = i.id
     where tz_day(s.created_at) between p_from and p_to),
  rp as (select * from repairs where status = 'berildi' and tz_day(done_at) between p_from and p_to),
  ex as (select * from expenses where tz_day(created_at) between p_from and p_to),
  vd as (select * from vend_income where tz_day(created_at) between p_from and p_to),
  dd as (select g::date d from generate_series(p_from, p_to, interval '1 day') g)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'top', (select coalesce(jsonb_agg(t), '[]') from (
        select name, line, sum(nq) qty, sum(nq * price_uzs) revenue, round(sum(nq * (price_uzs - unit_cost))) profit
          from it group by name, line having sum(nq) > 0 order by sum(nq) desc, sum(nq * price_uzs) desc limit 10) t),
    'top_profit', (select coalesce(jsonb_agg(t), '[]') from (
        select name, line, sum(nq) qty, sum(nq * price_uzs) revenue, round(sum(nq * (price_uzs - unit_cost))) profit
          from it group by name, line having sum(nq) > 0 order by sum(nq * (price_uzs - unit_cost)) desc limit 10) t),
    'lines', (select coalesce(jsonb_agg(t), '[]') from (
        select line, sum(nq) qty, sum(nq * price_uzs) revenue, round(sum(nq * (price_uzs - unit_cost))) profit
          from it group by line order by sum(nq * (price_uzs - unit_cost)) desc) t),
    'sellers', (select coalesce(jsonb_agg(t), '[]') from (
        select it.user_id id, p.name, count(distinct it.sale_id) sales, sum(nq) qty, sum(nq * price_uzs) revenue,
               round(sum(nq * (price_uzs - unit_cost))) profit
          from it left join profiles p on p.id = it.user_id group by it.user_id, p.name order by sum(nq * price_uzs) desc) t),
    'masters', (select coalesce(jsonb_agg(t), '[]') from (
        select rp.master_id id, coalesce(p.name, '—') name, count(*) cnt, sum(rp.fee_uzs) income
          from rp left join profiles p on p.id = rp.master_id group by rp.master_id, p.name order by sum(rp.fee_uzs) desc) t),
    'repairs_in', (select count(*) from repairs where tz_day(created_at) between p_from and p_to),
    'exp_cats', (select coalesce(jsonb_object_agg(cat, s), '{}') from (select cat, sum(amount_uzs) s from ex group by cat) t),
    'days', (select jsonb_agg(jsonb_build_object(
        'd', dd.d,
        'revenue', coalesce((select sum(nq * price_uzs) from it where it.d = dd.d), 0),
        'profit',  coalesce((select round(sum(nq * (price_uzs - unit_cost))) from it where it.d = dd.d), 0),
        'repair',  coalesce((select sum(fee_uzs) from rp where tz_day(rp.done_at) = dd.d), 0),
        'expenses',coalesce((select sum(amount_uzs) from ex where tz_day(ex.created_at) = dd.d), 0),
        'vend',    coalesce((select sum(amount_uzs) from vd where tz_day(vd.created_at) = dd.d), 0),
        'sales',   (select count(distinct sale_id) from it where it.d = dd.d)) order by dd.d) from dd)
  ) into j;
  return j || jsonb_build_object('totals', (select jsonb_build_object(
      'revenue', sum((x->>'revenue')::numeric), 'profit', sum((x->>'profit')::numeric), 'repair', sum((x->>'repair')::numeric),
      'expenses', sum((x->>'expenses')::numeric), 'vend', sum((x->>'vend')::numeric), 'sales', sum((x->>'sales')::numeric),
      'net', sum((x->>'profit')::numeric + (x->>'repair')::numeric + (x->>'vend')::numeric - (x->>'expenses')::numeric))
    from jsonb_array_elements(j->'days') x));
end $$;

-------------------------------------------------------------------------------
-- 4) Kafolat bazasi: shtrix-kod yoki seriya raqami bo'yicha
-------------------------------------------------------------------------------
create or replace function warranty_lookup(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')); v2 text; f jsonb;
begin
  if not is_staff() then raise exception 'Ruxsat yo''q'; end if;
  if length(v) < 2 then return jsonb_build_object('products', '[]'::jsonb, 'sales', '[]'::jsonb, 'repairs', '[]'::jsonb); end if;
  v2 := coalesce(nullif(ltrim(v, '0'), ''), v);
  select features into f from settings where id = 1;
  return jsonb_build_object(
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'barcode', p.barcode, 'line', p.line, 'qty', p.qty,
                   'warranty', coalesce(p.warranty, f->'warranty'->p.line), 'last_in', p.last_in, 'photo', p.photo)), '[]')
                 from products p where coalesce(nullif(ltrim(upper(p.barcode), '0'), ''), upper(p.barcode)) = v2),
    'sales', (select coalesce(jsonb_agg(x order by x.ts desc), '[]') from (
        select s.no, s.created_at ts, i.name, i.line, i.qty, i.price_uzs, s.pay,
               coalesce(i.warranty, p.warranty, f->'warranty'->i.line) warranty,
               s.client_phone, c.name client_name, u.name seller,
               coalesce((select sum(r.qty) from sale_returns r where r.item_id = i.id), 0) returned
          from sale_items i join sales s on s.id = i.sale_id join products p on p.id = i.product_id
          left join clients c on c.phone = s.client_phone left join profiles u on u.id = s.user_id
         where coalesce(nullif(ltrim(upper(p.barcode), '0'), ''), upper(p.barcode)) = v2
         order by s.created_at desc limit 50) x),
    'repairs', (select coalesce(jsonb_agg(x order by x.talon desc), '[]') from (
        select talon, created_at ts, device, model, serial, problem, status, client_name, client_phone, done_at
          from repairs where upper(regexp_replace(coalesce(serial, ''), '\s', '', 'g')) = v
         order by talon desc limit 20) x));
end $$;

-------------------------------------------------------------------------------
-- 5) Telegram kanallarga yangi tovar joylash navbati
-------------------------------------------------------------------------------
create table if not exists channel_posts (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  product_id  uuid references products on delete cascade,
  manual      boolean not null default false,
  user_id     uuid references profiles on delete set null,
  posted_at   timestamptz,
  message_id  bigint,
  error       text
);
create index if not exists channel_posts_pending_idx on channel_posts (created_at) where posted_at is null and error is null;
alter table channel_posts enable row level security;
grant select on channel_posts to authenticated;
grant all on channel_posts to service_role;
grant usage on sequence channel_posts_id_seq to service_role;
drop policy if exists chp_read on channel_posts;
create policy chp_read on channel_posts for select to authenticated using (is_staff());

-- Kirimda avtomatik navbatga qo'yiladi (yoqilgan bo'lsa va bo'limga kanal yozilgan bo'lsa)
create or replace function stock_moves_channel() returns trigger
language plpgsql security definer set search_path = public as $$
declare f jsonb; v_line text;
begin
  if new.delta <= 0 or new.reason <> 'kirim' or new.product_id is null then return new; end if;
  select features into f from settings where id = 1;
  if coalesce((f->>'autoPost')::boolean, false) = false then return new; end if;
  select line into v_line from products where id = new.product_id;
  if coalesce(f->'channels'->>v_line, '') = '' then return new; end if;
  if exists (select 1 from channel_posts where product_id = new.product_id and (posted_at is null and error is null or posted_at > now() - interval '3 days')) then
    return new;
  end if;
  insert into channel_posts (product_id, user_id) values (new.product_id, new.user_id);
  return new;
end $$;
drop trigger if exists stock_moves_channel_ai on stock_moves;
create trigger stock_moves_channel_ai after insert on stock_moves for each row execute function stock_moves_channel();

create or replace function channel_post_now(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_line text;
begin
  if not can_stock() then raise exception 'Ruxsat yo''q'; end if;
  select line into v_line from products where id = p_product;
  if v_line is null then raise exception 'Tovar topilmadi'; end if;
  if coalesce((select features->'channels'->>v_line from settings where id = 1), '') = '' then
    raise exception 'Bu bo''lim uchun kanal yozilmagan (Sozlamalar → Telegram kanallar)';
  end if;
  delete from channel_posts where product_id = p_product and posted_at is null;
  insert into channel_posts (product_id, manual, user_id) values (p_product, true, auth.uid());
end $$;
revoke execute on function channel_post_now(uuid) from anon, public;
grant execute on function channel_post_now(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 6) Mecanuz avtomatlari: har bir pul qabul qilinganda avtomat o'zi yozadi
-------------------------------------------------------------------------------
create table if not exists vend_devices (
  id          text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  name        text not null,
  token_hash  text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);
create table if not exists vend_income (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  device_id   text not null references vend_devices on delete cascade on update cascade,
  amount_uzs  numeric not null check (amount_uzs > 0 and amount_uzs <= 10000000),
  note        text,
  ext_id      text,
  unique (device_id, ext_id)
);
create index if not exists vend_income_created_idx on vend_income (created_at);
alter table vend_devices enable row level security;
alter table vend_income enable row level security;
grant select on vend_devices, vend_income to authenticated;
grant all on vend_devices, vend_income to service_role;
grant usage on sequence vend_income_id_seq to service_role;
drop policy if exists vd_read on vend_devices;
drop policy if exists vi_read on vend_income;
create policy vd_read on vend_devices for select to authenticated using (is_owner());
create policy vi_read on vend_income for select to authenticated using (is_owner());
do $$ begin alter publication supabase_realtime add table vend_income; exception when others then null; end $$;

-- Avtomat chaqiradi (kalit bilan). p_ext — takror yuborilsa ikki marta yozilmasligi uchun noyob raqam
create or replace function vend_add(p_device text, p_token text, p_amount numeric, p_ext text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d vend_devices; v_today numeric;
begin
  select * into d from vend_devices where id = p_device;
  if not found or not d.active or d.token_hash <> encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    raise exception 'forbidden';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Summa noto''g''ri'; end if;
  insert into vend_income (device_id, amount_uzs, note, ext_id) values (p_device, round(p_amount), left(p_note, 200), left(p_ext, 64))
  on conflict (device_id, ext_id) do nothing;
  update vend_devices set last_seen = now() where id = p_device;
  select coalesce(sum(amount_uzs), 0) into v_today from vend_income where device_id = p_device and tz_day(created_at) = tz_day(now());
  return jsonb_build_object('ok', true, 'today', v_today);
end $$;
revoke execute on function vend_add(text, text, numeric, text, text) from public;
grant execute on function vend_add(text, text, numeric, text, text) to anon, authenticated, service_role;

-- Rahbar: avtomat qo'shish / kalitni yangilash (kalit faqat bir marta ko'rsatiladi)
create or replace function vend_device_save(p_id text, p_name text, p_active boolean default true, p_new_token boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_tok text; v_new boolean;
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  p_id := lower(trim(p_id));
  v_new := not exists (select 1 from vend_devices where id = p_id);
  if v_new or p_new_token then v_tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); end if;
  if v_new then
    insert into vend_devices (id, name, token_hash, active) values (p_id, coalesce(nullif(trim(p_name), ''), p_id),
      encode(sha256(convert_to(v_tok, 'UTF8')), 'hex'), coalesce(p_active, true));
  else
    update vend_devices set name = coalesce(nullif(trim(p_name), ''), name), active = coalesce(p_active, active),
      token_hash = case when v_tok is not null then encode(sha256(convert_to(v_tok, 'UTF8')), 'hex') else token_hash end
     where id = p_id;
  end if;
  return v_tok;
end $$;
create or replace function vend_device_delete(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  delete from vend_devices where id = p_id;
end $$;
revoke execute on function vend_device_save(text, text, boolean, boolean), vend_device_delete(text) from anon, public;
grant execute on function vend_device_save(text, text, boolean, boolean), vend_device_delete(text) to authenticated;

-------------------------------------------------------------------------------
-- 1) Bot: talon holati va "Olib ketaman" (faqat server)
-------------------------------------------------------------------------------
create or replace function bot_talon(p_chat bigint, p_talon int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r repairs; v_mine boolean;
begin
  select * into r from repairs where talon = p_talon;
  if not found then return jsonb_build_object('found', false); end if;
  select exists (select 1 from clients c where c.tg_chat_id = p_chat
     and right(regexp_replace(c.phone, '\D', '', 'g'), 9) in (right(regexp_replace(r.client_phone, '\D', '', 'g'), 9),
                                                             right(regexp_replace(coalesce(r.client_phone2, '-'), '\D', '', 'g'), 9)))
    into v_mine;
  return jsonb_build_object('found', true, 'mine', v_mine, 'talon', r.talon, 'status', r.status, 'device', r.device,
    'model', case when v_mine then r.model end, 'fee', case when v_mine then r.fee_uzs end,
    'name', case when v_mine then r.client_name end, 'pickup', r.pickup_at is not null, 'created', r.created_at);
end $$;

create or replace function bot_pickup(p_chat bigint, p_talon int, p_kind text default 'pickup') returns jsonb
language plpgsql security definer set search_path = public as $$
declare j jsonb; r repairs;
begin
  j := bot_talon(p_chat, p_talon);
  if not coalesce((j->>'mine')::boolean, false) then return jsonb_build_object('ok', false, 'why', 'not_mine'); end if;
  select * into r from repairs where talon = p_talon;
  if p_kind = 'pickup' then
    if r.status <> 'tayyor' then return jsonb_build_object('ok', false, 'why', 'not_ready', 'status', r.status); end if;
    update repairs set pickup_at = now() where talon = p_talon;
    insert into notifications (kind, level, title, body, ref)
    values ('info', 'good', '№' || r.talon || ' — mijoz olib ketishini aytdi', r.client_name || ' · ' || r.client_phone || ' · ' || r.device || coalesce(' ' || r.model, ''),
            'pickup-' || r.talon || '-' || to_char(now(), 'YYYYMMDDHH24MI'))
    on conflict (ref) do nothing;
  else
    insert into notifications (kind, level, title, body, ref)
    values ('info', 'info', '№' || r.talon || ' — mijoz qo''ng''iroq qilishni so''radi', r.client_name || ' · ' || r.client_phone || ' · ' || r.device,
            'call-' || r.talon || '-' || to_char(now(), 'YYYYMMDDHH24MI'))
    on conflict (ref) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'talon', r.talon, 'name', r.client_name, 'phone', r.client_phone, 'device', r.device, 'model', r.model, 'fee', r.fee_uzs);
end $$;
revoke execute on function bot_talon(bigint, int), bot_pickup(bigint, int, text) from anon, authenticated, public;
grant execute on function bot_talon(bigint, int), bot_pickup(bigint, int, text) to service_role;

revoke execute on function analytics(date, date), warranty_lookup(text) from anon, public;
grant execute on function analytics(date, date), warranty_lookup(text) to authenticated, service_role;
revoke execute on function low_thr(products) from anon, public;

-------------------------------------------------------------------------------
-- Tovar rasmlari uchun ochiq papka (Supabase Storage)
-------------------------------------------------------------------------------
do $$ begin
  insert into storage.buckets (id, name, public) values ('products', 'products', true) on conflict (id) do nothing;
  begin execute 'drop policy if exists products_photo_insert on storage.objects'; exception when others then null; end;
  begin execute 'drop policy if exists products_photo_update on storage.objects'; exception when others then null; end;
  execute $p$create policy products_photo_insert on storage.objects for insert to authenticated with check (bucket_id = 'products' and public.is_staff())$p$;
  execute $p$create policy products_photo_update on storage.objects for update to authenticated using (bucket_id = 'products' and public.is_staff())$p$;
exception when undefined_table or invalid_schema_name then null;
end $$;
