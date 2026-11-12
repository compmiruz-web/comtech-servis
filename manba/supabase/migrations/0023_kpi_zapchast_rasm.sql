-- 0023: qo'lda KPI, oylik cheki, talonga zapchast, servis ishini ustalarga bo'lish, rasxodni tahrirlash, tovarga bir nechta rasm

-------------------------------------------------------------------------------
-- 1) Qo'lda KPI (masalan noutbuk sotgani uchun rahbar o'zi summa qo'yadi)
-------------------------------------------------------------------------------
create table if not exists kpi_bonus (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  month       text not null,                                   -- 'YYYY-MM' — qaysi oy oyligiga qo'shiladi
  user_id     uuid not null references profiles on delete cascade,
  amount      numeric not null check (amount <> 0),
  reason      text,
  sale_id     uuid references sales on delete set null,
  talon       int,
  created_by  uuid references profiles on delete set null default auth.uid()
);
create index if not exists kpi_bonus_um_idx on kpi_bonus (user_id, month);
alter table kpi_bonus enable row level security;
grant select, insert, update, delete on kpi_bonus to authenticated;
grant all on kpi_bonus to service_role;
do $$ begin alter publication supabase_realtime add table kpi_bonus; exception when others then null; end $$;
drop policy if exists kpib_owner on kpi_bonus;
create policy kpib_owner on kpi_bonus for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists kpib_self on kpi_bonus;
create policy kpib_self on kpi_bonus for select to authenticated using (
  user_id = auth.uid() and exists (select 1 from profiles where id = auth.uid() and see_salary));

-------------------------------------------------------------------------------
-- 2) Servis ishini bir nechta ustaga bo'lish (har biri qilgan ish summasi)
-------------------------------------------------------------------------------
create table if not exists repair_workers (
  talon    int not null references repairs on delete cascade,
  user_id  uuid not null references profiles on delete cascade,
  amount   numeric not null check (amount > 0),
  primary key (talon, user_id)
);
alter table repair_workers enable row level security;
grant select on repair_workers to authenticated;
grant all on repair_workers to service_role;
do $$ begin alter publication supabase_realtime add table repair_workers; exception when others then null; end $$;
drop policy if exists rw_read on repair_workers;
create policy rw_read on repair_workers for select to authenticated using (is_staff());

create or replace function repair_set_workers(p_talon int, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r repairs; it jsonb; v_sum numeric := 0;
begin
  select * into r from repairs where talon = p_talon;
  if not found then raise exception 'Talon topilmadi'; end if;
  if not (is_owner() or r.master_id = auth.uid()) then raise exception 'Ishni faqat rahbar yoki shu talon ustasi bo''ladi'; end if;
  delete from repair_workers where talon = p_talon;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    if nullif(it->>'user_id', '') is null or coalesce(nullif(it->>'amount', '')::numeric, 0) <= 0 then continue; end if;
    insert into repair_workers (talon, user_id, amount) values (p_talon, (it->>'user_id')::uuid, round((it->>'amount')::numeric))
    on conflict (talon, user_id) do update set amount = repair_workers.amount + excluded.amount;
    v_sum := v_sum + round((it->>'amount')::numeric);
  end loop;
  if r.fee_uzs > 0 and v_sum > r.fee_uzs then raise exception 'Ustalar summasi (% so''m) servis narxidan (% so''m) oshmasin', v_sum, r.fee_uzs; end if;
end $$;
revoke execute on function repair_set_workers(int, jsonb) from anon, public;
grant execute on function repair_set_workers(int, jsonb) to authenticated;

-------------------------------------------------------------------------------
-- 3) Talonga zapchast sotish: sotuv talonga bog'lanadi
-------------------------------------------------------------------------------
alter table sales add column if not exists repair_talon int;
create index if not exists sales_talon_idx on sales (repair_talon) where repair_talon is not null;

create or replace function sale_link_talon(p_sale uuid, p_talon int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_talon is not null and not exists (select 1 from repairs where talon = p_talon) then raise exception '№% talon topilmadi', p_talon; end if;
  update sales set repair_talon = p_talon where id = p_sale and (is_owner() or user_id = auth.uid());
  if not found then raise exception 'Sotuv topilmadi'; end if;
end $$;
revoke execute on function sale_link_talon(uuid, int) from anon, public;
grant execute on function sale_link_talon(uuid, int) to authenticated;

-------------------------------------------------------------------------------
-- 4) Rahbar rasxodni (va berilgan oylikni) tahrirlaydi
-------------------------------------------------------------------------------
drop policy if exists exp_update on expenses;
create policy exp_update on expenses for update to authenticated using (is_owner()) with check (is_owner());

-------------------------------------------------------------------------------
-- 5) Oylik: servis ishi bo'lingan bo'lsa — har kimga o'z summasi; qo'lda KPI qo'shiladi
-------------------------------------------------------------------------------
create or replace function kpi_repair_base(p_user uuid, p_role text, p_month text) returns numeric
language sql stable security definer set search_path = public as $$
  select
    -- bo'linmagan talonlar: butun narx ustaga (faqat usta lavozimlari)
    (case when p_role in ('usta','usta_sotuvchi') then
      (select coalesce(sum(r.fee_uzs),0) from repairs r where r.master_id = p_user and r.status = 'berildi'
         and to_char(tz_day(r.done_at),'YYYY-MM') = p_month
         and not exists (select 1 from repair_workers w where w.talon = r.talon))
     else 0 end)
    -- bo'lingan talonlar: har kim o'zi qilgan ish summasi
    + (select coalesce(sum(w.amount),0) from repair_workers w join repairs r on r.talon = w.talon
        where w.user_id = p_user and r.status = 'berildi' and to_char(tz_day(r.done_at),'YYYY-MM') = p_month);
$$;

revoke execute on function kpi_repair_base(uuid, text, text) from anon, public;

drop function if exists payroll(text);
create function payroll(p_month text)
returns table (user_id uuid, name text, role text, oklad numeric, kpi numeric, kpi_base text,
               base numeric, kpi_sum numeric, total numeric, paid numeric, left_to_pay numeric, bonus numeric)
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
      kpi_repair_base(u.id, u.role, p_month)
      + (case when u.role in ('sotuvchi','usta_sotuvchi') then
        (case when u.kpi_base = 'tushum' then
          (select coalesce(sum(s.total_uzs),0) from sales s where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month)
        - (select coalesce(sum(r.refund_uzs),0) from sale_returns r join sales s on s.id = r.sale_id
             where s.user_id = u.id and to_char(tz_day(r.created_at),'YYYY-MM') = p_month)
        else
          (select coalesce(sum(i.qty * (i.price_uzs - c.cost_usd * c.rate)),0) from sales s join sale_items i on i.sale_id = s.id
           join sale_item_costs c on c.item_id = i.id where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month)
        - (select coalesce(sum(r.qty * (i.price_uzs - c.cost_usd * c.rate)),0) from sale_returns r join sale_items i on i.id = r.item_id
             join sales s on s.id = r.sale_id join sale_item_costs c on c.item_id = i.id
             where s.user_id = u.id and to_char(tz_day(r.created_at),'YYYY-MM') = p_month)
        end)
      else 0 end) as base,
      (select coalesce(sum(k.amount),0) from kpi_bonus k where k.user_id = u.id and k.month = p_month) as bonus,
      (select coalesce(sum(e.amount_uzs),0) from expenses e where e.cat = 'oylik' and e.to_user = u.id
         and to_char(tz_day(e.created_at),'YYYY-MM') = p_month) as paid
    from u
  )
  select b.id, b.name, b.role, b.oklad, b.kpi, b.kpi_base, b.base,
         round(b.base * b.kpi / 100) + b.bonus, b.oklad + round(b.base * b.kpi / 100) + b.bonus, b.paid,
         b.oklad + round(b.base * b.kpi / 100) + b.bonus - b.paid, b.bonus
  from b order by b.name;
end $$;
revoke execute on function payroll(text) from anon, public;
grant execute on function payroll(text) to authenticated;

-- Oylik cheki uchun batafsil: nima uchun qancha KPI
create or replace function payroll_detail(p_user uuid, p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr record; v_role text;
begin
  select * into pr from payroll(p_month) x where x.user_id = p_user;
  if not found then raise exception 'Ruxsat yo''q yoki xodim topilmadi'; end if;
  v_role := pr.role;
  return jsonb_build_object(
    'user_id', pr.user_id, 'name', pr.name, 'role', pr.role, 'month', p_month,
    'oklad', pr.oklad, 'kpi', pr.kpi, 'kpi_base', pr.kpi_base, 'base', pr.base, 'kpi_sum', pr.kpi_sum,
    'bonus', pr.bonus, 'total', pr.total, 'paid', pr.paid, 'left', pr.left_to_pay,
    'repairs', (select coalesce(jsonb_agg(x order by x.done_at), '[]') from (
        select r.talon, r.device, r.model, r.done_at, r.fee_uzs fee, r.fee_uzs amount, false shared
          from repairs r where v_role in ('usta','usta_sotuvchi') and r.master_id = p_user and r.status = 'berildi'
           and to_char(tz_day(r.done_at),'YYYY-MM') = p_month and not exists (select 1 from repair_workers w where w.talon = r.talon)
        union all
        select r.talon, r.device, r.model, r.done_at, r.fee_uzs, w.amount, true
          from repair_workers w join repairs r on r.talon = w.talon
         where w.user_id = p_user and r.status = 'berildi' and to_char(tz_day(r.done_at),'YYYY-MM') = p_month) x),
    'sales', case when v_role in ('sotuvchi','usta_sotuvchi') then (select coalesce(jsonb_agg(x order by x.ts), '[]') from (
        select s.no, s.created_at ts, i.name, i.qty, i.price_uzs price, round(i.qty * (i.price_uzs - c.cost_usd * c.rate)) profit
          from sales s join sale_items i on i.sale_id = s.id join sale_item_costs c on c.item_id = i.id
         where s.user_id = p_user and to_char(tz_day(s.created_at),'YYYY-MM') = p_month) x) else '[]'::jsonb end,
    'returns', case when v_role in ('sotuvchi','usta_sotuvchi') then (select coalesce(jsonb_agg(x order by x.ts), '[]') from (
        select r.created_at ts, i.name, r.qty, r.refund_uzs refund, round(r.qty * (i.price_uzs - c.cost_usd * c.rate)) profit
          from sale_returns r join sale_items i on i.id = r.item_id join sales s on s.id = r.sale_id join sale_item_costs c on c.item_id = i.id
         where s.user_id = p_user and to_char(tz_day(r.created_at),'YYYY-MM') = p_month) x) else '[]'::jsonb end,
    'bonuses', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'ts', k.created_at, 'amount', k.amount, 'reason', k.reason) order by k.created_at), '[]')
        from kpi_bonus k where k.user_id = p_user and k.month = p_month),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('ts', e.created_at, 'amount', e.amount_uzs, 'note', e.note, 'pay', e.pay) order by e.created_at), '[]')
        from expenses e where e.cat = 'oylik' and e.to_user = p_user and to_char(tz_day(e.created_at),'YYYY-MM') = p_month)
  );
end $$;
revoke execute on function payroll_detail(uuid, text) from anon, public;
grant execute on function payroll_detail(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- 6) Tovarga bir nechta rasm (birinchisi — asosiy, kanalga albom bo'lib ketadi)
-------------------------------------------------------------------------------
alter table products add column if not exists photos jsonb not null default '[]'::jsonb;
update products set photos = jsonb_build_array(photo) where photo is not null and photo <> '' and photos = '[]'::jsonb;

create or replace function product_set_extra(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_stock() then raise exception 'Ruxsat yo''q'; end if;
  update products set
    warranty = case when p ? 'warranty' then nullif(p->'warranty', 'null'::jsonb) else warranty end,
    photos   = case when p ? 'photos' then coalesce(p->'photos', '[]'::jsonb) else photos end,
    photo    = case when p ? 'photos' then nullif(p->'photos'->>0, '') when p ? 'photo' then nullif(p->>'photo', '') else photo end,
    min_qty  = case when p ? 'min_qty' then nullif(p->>'min_qty', '')::int else min_qty end
  where id = p_id;
  if not found then raise exception 'Tovar topilmadi'; end if;
end $$;
revoke execute on function product_set_extra(uuid, jsonb) from anon, public;
grant execute on function product_set_extra(uuid, jsonb) to authenticated;
