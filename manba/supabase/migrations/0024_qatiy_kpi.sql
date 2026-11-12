-- 0024: bo'lim bo'yicha qat'iy KPI (masalan har bir sotilgan noutbuk uchun 100 000 so'm)
-- Qat'iy KPI qo'yilgan bo'limdagi sotuvlar foizli KPI hisobiga kirmaydi; qolgan sotuvlar avvalgidek foizda.

alter table staff_pay add column if not exists fixed_kpi jsonb not null default '{}'::jsonb;   -- {"noutbuk": 100000}

-- Bilol xoji va Zaylobiddin: har bir noutbuk uchun 100 000 so'm
insert into staff_pay (user_id)
select id from profiles where role <> 'owner' and (name ilike '%bilol%' or name ilike '%zaylobiddin%' or name ilike '%zaynobiddin%')
on conflict (user_id) do nothing;
update staff_pay sp set fixed_kpi = coalesce(sp.fixed_kpi, '{}'::jsonb) || '{"noutbuk": 100000}'::jsonb
  from profiles p where p.id = sp.user_id and p.role <> 'owner'
   and (p.name ilike '%bilol%' or p.name ilike '%zaylobiddin%' or p.name ilike '%zaynobiddin%');

drop function if exists payroll(text);
create function payroll(p_month text)
returns table (user_id uuid, name text, role text, oklad numeric, kpi numeric, kpi_base text,
               base numeric, kpi_sum numeric, total numeric, paid numeric, left_to_pay numeric, bonus numeric, fixed numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with u as (
    select pr.id, pr.name, pr.role, coalesce(sp.oklad,0) oklad, coalesce(sp.kpi,0) kpi, coalesce(sp.kpi_base,'foyda') kpi_base,
           coalesce(sp.fixed_kpi, '{}'::jsonb) fx
    from profiles pr left join staff_pay sp on sp.user_id = pr.id
    where pr.role <> 'owner' and pr.active
      and (is_owner() or (pr.id = auth.uid() and pr.see_salary
           and coalesce((select (mods->>'salary')::boolean from settings where id = 1), false)))
  ), b as (
    select u.*,
      kpi_repair_base(u.id, u.role, p_month)
      + (case when u.role in ('sotuvchi','usta_sotuvchi') then
        (case when u.kpi_base = 'tushum' then
          (select coalesce(sum(i.qty * i.price_uzs),0) from sales s join sale_items i on i.sale_id = s.id
            where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month
              and coalesce((u.fx->>i.line)::numeric, 0) = 0)
        - (select coalesce(sum(r.refund_uzs),0) from sale_returns r join sales s on s.id = r.sale_id join sale_items i on i.id = r.item_id
             where s.user_id = u.id and to_char(tz_day(r.created_at),'YYYY-MM') = p_month
               and coalesce((u.fx->>i.line)::numeric, 0) = 0)
        else
          (select coalesce(sum(i.qty * (i.price_uzs - c.cost_usd * c.rate)),0) from sales s join sale_items i on i.sale_id = s.id
           join sale_item_costs c on c.item_id = i.id where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month
             and coalesce((u.fx->>i.line)::numeric, 0) = 0)
        - (select coalesce(sum(r.qty * (i.price_uzs - c.cost_usd * c.rate)),0) from sale_returns r join sale_items i on i.id = r.item_id
             join sales s on s.id = r.sale_id join sale_item_costs c on c.item_id = i.id
             where s.user_id = u.id and to_char(tz_day(r.created_at),'YYYY-MM') = p_month
               and coalesce((u.fx->>i.line)::numeric, 0) = 0)
        end)
      else 0 end) as base,
      -- qat'iy KPI: har dona uchun belgilangan summa, vazvrat ayriladi
      (select coalesce(sum(i.qty * (u.fx->>i.line)::numeric),0) from sales s join sale_items i on i.sale_id = s.id
         where s.user_id = u.id and to_char(tz_day(s.created_at),'YYYY-MM') = p_month and coalesce((u.fx->>i.line)::numeric, 0) > 0)
      - (select coalesce(sum(r.qty * (u.fx->>i.line)::numeric),0) from sale_returns r join sale_items i on i.id = r.item_id join sales s on s.id = r.sale_id
         where s.user_id = u.id and to_char(tz_day(r.created_at),'YYYY-MM') = p_month and coalesce((u.fx->>i.line)::numeric, 0) > 0) as fixed,
      (select coalesce(sum(k.amount),0) from kpi_bonus k where k.user_id = u.id and k.month = p_month) as bonus,
      (select coalesce(sum(e.amount_uzs),0) from expenses e where e.cat = 'oylik' and e.to_user = u.id
         and to_char(tz_day(e.created_at),'YYYY-MM') = p_month) as paid
    from u
  )
  select b.id, b.name, b.role, b.oklad, b.kpi, b.kpi_base, b.base,
         round(b.base * b.kpi / 100) + b.bonus + b.fixed,
         b.oklad + round(b.base * b.kpi / 100) + b.bonus + b.fixed, b.paid,
         b.oklad + round(b.base * b.kpi / 100) + b.bonus + b.fixed - b.paid, b.bonus, b.fixed
  from b order by b.name;
end $$;
revoke execute on function payroll(text) from anon, public;
grant execute on function payroll(text) to authenticated;

create or replace function payroll_detail(p_user uuid, p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr record; v_role text; v_fx jsonb;
begin
  select * into pr from payroll(p_month) x where x.user_id = p_user;
  if not found then raise exception 'Ruxsat yo''q yoki xodim topilmadi'; end if;
  v_role := pr.role;
  select coalesce(fixed_kpi, '{}'::jsonb) into v_fx from staff_pay where user_id = p_user;
  v_fx := coalesce(v_fx, '{}'::jsonb);
  return jsonb_build_object(
    'user_id', pr.user_id, 'name', pr.name, 'role', pr.role, 'month', p_month,
    'oklad', pr.oklad, 'kpi', pr.kpi, 'kpi_base', pr.kpi_base, 'base', pr.base, 'kpi_sum', pr.kpi_sum,
    'bonus', pr.bonus, 'fixed', pr.fixed, 'fixed_kpi', v_fx, 'total', pr.total, 'paid', pr.paid, 'left', pr.left_to_pay,
    'repairs', (select coalesce(jsonb_agg(x order by x.done_at), '[]') from (
        select r.talon, r.device, r.model, r.done_at, r.fee_uzs fee, r.fee_uzs amount, false shared
          from repairs r where v_role in ('usta','usta_sotuvchi') and r.master_id = p_user and r.status = 'berildi'
           and to_char(tz_day(r.done_at),'YYYY-MM') = p_month and not exists (select 1 from repair_workers w where w.talon = r.talon)
        union all
        select r.talon, r.device, r.model, r.done_at, r.fee_uzs, w.amount, true
          from repair_workers w join repairs r on r.talon = w.talon
         where w.user_id = p_user and r.status = 'berildi' and to_char(tz_day(r.done_at),'YYYY-MM') = p_month) x),
    'sales', (select coalesce(jsonb_agg(x order by x.ts), '[]') from (
        select s.no, s.created_at ts, i.name, i.line, i.qty, i.price_uzs price, round(i.qty * (i.price_uzs - c.cost_usd * c.rate)) profit,
               coalesce((v_fx->>i.line)::numeric, 0) fx
          from sales s join sale_items i on i.sale_id = s.id join sale_item_costs c on c.item_id = i.id
         where s.user_id = p_user and to_char(tz_day(s.created_at),'YYYY-MM') = p_month
           and (v_role in ('sotuvchi','usta_sotuvchi') or coalesce((v_fx->>i.line)::numeric, 0) > 0)) x),
    'returns', (select coalesce(jsonb_agg(x order by x.ts), '[]') from (
        select r.created_at ts, i.name, r.qty, r.refund_uzs refund, round(r.qty * (i.price_uzs - c.cost_usd * c.rate)) profit,
               coalesce((v_fx->>i.line)::numeric, 0) fx
          from sale_returns r join sale_items i on i.id = r.item_id join sales s on s.id = r.sale_id join sale_item_costs c on c.item_id = i.id
         where s.user_id = p_user and to_char(tz_day(r.created_at),'YYYY-MM') = p_month
           and (v_role in ('sotuvchi','usta_sotuvchi') or coalesce((v_fx->>i.line)::numeric, 0) > 0)) x),
    'bonuses', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'ts', k.created_at, 'amount', k.amount, 'reason', k.reason) order by k.created_at), '[]')
        from kpi_bonus k where k.user_id = p_user and k.month = p_month),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('ts', e.created_at, 'amount', e.amount_uzs, 'note', e.note, 'pay', e.pay) order by e.created_at), '[]')
        from expenses e where e.cat = 'oylik' and e.to_user = p_user and to_char(tz_day(e.created_at),'YYYY-MM') = p_month)
  );
end $$;
revoke execute on function payroll_detail(uuid, text) from anon, public;
grant execute on function payroll_detail(uuid, text) to authenticated;

-- Kimga qo'yilganini ko'rsatish
select p.name, sp.fixed_kpi from staff_pay sp join profiles p on p.id = sp.user_id where sp.fixed_kpi <> '{}'::jsonb;
