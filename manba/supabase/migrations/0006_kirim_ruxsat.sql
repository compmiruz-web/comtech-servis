-- Xodimga omborga tovar qo'shish ruxsati (rahbar yoqib/o'chiradi)
alter table profiles add column if not exists can_stock boolean not null default false;
update settings set mods = mods || '{"stockin":true}'::jsonb where id = 1 and not (mods ? 'stockin');

create or replace function can_stock() returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner() or (
    coalesce((select (mods->>'stockin')::boolean from settings where id = 1), true)
    and exists (select 1 from profiles where id = auth.uid() and can_stock and active))
$$;

-- Kirim: rahbar yoki ruxsati bor xodim. Narx bo'sh qoldirilsa (mavjud tovar), eski narx saqlanadi.
create or replace function stock_in(p_barcode text, p_name text, p_line text, p_qty int, p_cost numeric, p_sell numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_new boolean;
begin
  if not can_stock() then raise exception 'Omborga tovar qo''shishga ruxsat yo''q'; end if;
  if coalesce(p_qty, 0) < 1 then raise exception 'Soni noto''g''ri'; end if;
  v_new := not exists (select 1 from products where barcode = p_barcode);
  if v_new and (p_cost is null or p_sell is null) then raise exception 'Yangi tovar uchun kelish va sotish narxini kiriting'; end if;
  insert into products (name, barcode, line, qty, sell_usd)
  values (p_name, p_barcode, p_line, p_qty, coalesce(p_sell, 0))
  on conflict (barcode) do update
    set qty = products.qty + excluded.qty,
        sell_usd = coalesce(p_sell, products.sell_usd),
        line = excluded.line,
        name = coalesce(nullif(excluded.name,''), products.name)
  returning id into v_id;
  if p_cost is not null then
    insert into product_costs (product_id, cost_usd) values (v_id, p_cost)
    on conflict (product_id) do update set cost_usd = excluded.cost_usd;
  end if;
  insert into stock_moves (product_id, delta, reason, user_id) values (v_id, p_qty, 'kirim', auth.uid());
  return v_id;
end $$;

revoke execute on function can_stock() from anon;
grant execute on function can_stock(), stock_in(text,text,text,int,numeric,numeric) to authenticated;
