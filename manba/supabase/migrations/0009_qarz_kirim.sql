-- Qarzga olingan tovar darhol omborga kirim bo'ladi; sotilganda odatdagidek ombordan chiqadi
alter table supplier_debts add column if not exists product_id uuid references products on delete set null;
alter table supplier_debts add column if not exists barcode text;

create or replace function debt_stock_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric; v_qty int := coalesce((p->>'qty')::int, 0); v_sum numeric := (p->>'amount')::numeric;
  v_cur text := coalesce(p->>'currency', 'usd'); v_bar text := nullif(trim(p->>'barcode'), '');
  v_sell numeric := nullif(p->>'sell', '')::numeric; v_unit_usd numeric; v_pid uuid; v_new boolean; v_debt supplier_debts;
begin
  if not can_add_debt() then raise exception 'Qarz kiritishga ruxsat yo''q'; end if;
  if v_qty < 1 then raise exception 'Soni noto''g''ri'; end if;
  if coalesce(v_sum, 0) <= 0 then raise exception 'Summani kiriting'; end if;
  if coalesce(trim(p->>'supplier'), '') = '' or coalesce(trim(p->>'name'), '') = '' then raise exception 'Kimdan va tovar nomini kiriting'; end if;
  select rate into v_rate from settings where id = 1;

  if v_bar is not null then
    v_new := not exists (select 1 from products where barcode = v_bar);
    if v_new and v_sell is null then raise exception 'Yangi tovar uchun sotish narxini kiriting'; end if;
    v_unit_usd := round(case when v_cur = 'uzs' then v_sum / v_qty / nullif(v_rate, 0) else v_sum / v_qty end, 2);
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
    insert into product_costs (product_id, cost_usd) values (v_pid, v_unit_usd)
    on conflict (product_id) do update set cost_usd = excluded.cost_usd;
    insert into stock_moves (product_id, delta, reason, user_id, ref) values (v_pid, v_qty, 'kirim', auth.uid(), 'qarz');
  end if;

  insert into supplier_debts (user_id, supplier, phone, item_type, item_name, qty, amount, currency, due_date, note, product_id, barcode)
  values (auth.uid(), trim(p->>'supplier'), nullif(p->>'phone', ''), nullif(p->>'type', ''), p->>'name', v_qty, v_sum, v_cur,
          nullif(p->>'due', '')::date, nullif(p->>'note', ''), v_pid, v_bar)
  returning * into v_debt;
  return jsonb_build_object('debt_id', v_debt.id, 'product_id', v_pid, 'stocked', v_pid is not null);
end $$;
revoke execute on function debt_stock_in(jsonb) from anon, public;
grant execute on function debt_stock_in(jsonb) to authenticated;
