-- "Usta va sotuvchi" (ikkalasi ham) lavozimi
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner','usta','sotuvchi','usta_sotuvchi'));

-- Rahbar xodim lavozimini o'zgartiradi
create or replace function owner_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  if p_role not in ('usta','sotuvchi','usta_sotuvchi') then raise exception 'Lavozim noto''g''ri'; end if;
  if exists (select 1 from profiles where id = p_user and role = 'owner') then raise exception 'Rahbar lavozimini o''zgartirib bo''lmaydi'; end if;
  update profiles set role = p_role where id = p_user;
end $$;
revoke execute on function owner_set_role(uuid,text) from anon, public;
grant execute on function owner_set_role(uuid,text) to authenticated;

-- Oylik/KPI: ikkalasi bo'lsa remont summasi + savdo (foyda yoki tushum) birga hisoblanadi
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
      (case when u.role in ('usta','usta_sotuvchi') then
        (select coalesce(sum(r.fee_uzs),0) from repairs r where r.master_id = u.id and r.status = 'berildi'
           and to_char(tz_day(r.done_at),'YYYY-MM') = p_month)
      else 0 end)
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
      (select coalesce(sum(e.amount_uzs),0) from expenses e where e.cat = 'oylik' and e.to_user = u.id
         and to_char(tz_day(e.created_at),'YYYY-MM') = p_month) as paid
    from u
  )
  select b.id, b.name, b.role, b.oklad, b.kpi, b.kpi_base, b.base,
         round(b.base * b.kpi / 100), b.oklad + round(b.base * b.kpi / 100), b.paid,
         b.oklad + round(b.base * b.kpi / 100) - b.paid
  from b order by b.name;
end $$;
