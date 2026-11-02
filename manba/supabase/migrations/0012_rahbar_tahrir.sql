-- Rahbar: tovarning barcha parametrlarini, kirim va chiqim (sotuv) summalarini o'zgartirish

-- Tovarni tahrirlash yoki yangi qo'shish (soni o'zgarsa ombor harakatiga "tuzatish" yoziladi)
create or replace function owner_product_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_old products; v_qty int := (p->>'qty')::int; v_rate numeric;
  v_sell_usd numeric := nullif(p->>'sell_usd','')::numeric; v_sell_uzs numeric := nullif(p->>'sell_uzs','')::numeric;
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  if coalesce(trim(p->>'name'),'') = '' or coalesce(trim(p->>'barcode'),'') = '' then raise exception 'Nomi va shtrix-kodi shart'; end if;
  if v_qty is null or v_qty < 0 then raise exception 'Soni noto''g''ri'; end if;
  select rate into v_rate from settings where id = 1;
  if v_sell_uzs is not null then v_sell_usd := round(v_sell_uzs / nullif(v_rate,0), 2); end if;
  if exists (select 1 from products where barcode = trim(p->>'barcode') and id is distinct from v_id) then
    raise exception 'Bu shtrix-kod boshqa tovarda bor';
  end if;
  if v_id is null then
    insert into products (name, barcode, line, qty, sell_usd, sell_uzs)
    values (trim(p->>'name'), trim(p->>'barcode'), coalesce(nullif(p->>'line',''),'kompyuter'), v_qty, coalesce(v_sell_usd,0), v_sell_uzs)
    returning id into v_id;
    if v_qty > 0 then insert into stock_moves (product_id, delta, reason, user_id, ref) values (v_id, v_qty, 'kirim', auth.uid(), 'rahbar'); end if;
  else
    select * into v_old from products where id = v_id for update;
    if not found then raise exception 'Tovar topilmadi'; end if;
    update products set name = trim(p->>'name'), barcode = trim(p->>'barcode'), line = coalesce(nullif(p->>'line',''), line),
      qty = v_qty, sell_usd = coalesce(v_sell_usd, sell_usd), sell_uzs = case when p ? 'sell_uzs' then v_sell_uzs else sell_uzs end
    where id = v_id;
    if v_qty <> v_old.qty then
      insert into stock_moves (product_id, delta, reason, user_id, ref) values (v_id, v_qty - v_old.qty, 'tuzatish', auth.uid(), 'rahbar');
    end if;
  end if;
  if nullif(p->>'cost_usd','') is not null then
    insert into product_costs (product_id, cost_usd) values (v_id, (p->>'cost_usd')::numeric)
    on conflict (product_id) do update set cost_usd = excluded.cost_usd;
  end if;
  return v_id;
end $$;

create or replace function owner_product_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  delete from products where id = p_id;   -- sotuvlar tarixida nomi saqlanib qoladi
end $$;

-- Ombor harakatini (kirim / tuzatish) o'zgartirish yoki o'chirish: tovar soni farq qadar o'zgaradi
create or replace function owner_move_edit(p_id bigint, p_delta int) returns void
language plpgsql security definer set search_path = public as $$
declare m stock_moves; v_have int;
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  select * into m from stock_moves where id = p_id for update;
  if not found then raise exception 'Yozuv topilmadi'; end if;
  if m.reason = 'sotuv' then raise exception 'Sotuvni "Sotuvlar" bo''limida tahrirlang'; end if;
  select qty into v_have from products where id = m.product_id for update;
  if v_have is not null and v_have + (coalesce(p_delta,0) - m.delta) < 0 then raise exception 'Omborda bunchalik tovar qolmagan (hozir % dona)', v_have; end if;
  update products set qty = qty + (coalesce(p_delta,0) - m.delta) where id = m.product_id;
  if coalesce(p_delta,0) = 0 then delete from stock_moves where id = p_id;
  else update stock_moves set delta = p_delta where id = p_id; end if;
end $$;

-- Sotilgan tovar narxi va sonini o'zgartirish (chiqim summasi)
create or replace function owner_sale_item_edit(p_item bigint, p_qty int, p_price numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it sale_items; v_ret int; v_diff int; v_have int; v_total numeric; v_old_total numeric; s sales;
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  select * into it from sale_items where id = p_item for update;
  if not found then raise exception 'Sotuv qatori topilmadi'; end if;
  select * into s from sales where id = it.sale_id for update;
  select coalesce(sum(qty),0) into v_ret from sale_returns where item_id = p_item;
  if p_qty < greatest(v_ret, 1) then raise exception 'Soni % dan kam bo''lmasin (qaytarilgan: %)', greatest(v_ret,1), v_ret; end if;
  if p_price < 0 then raise exception 'Narx noto''g''ri'; end if;
  v_diff := p_qty - it.qty;
  if v_diff <> 0 and it.product_id is not null then
    select qty into v_have from products where id = it.product_id for update;
    if v_diff > 0 and coalesce(v_have,0) < v_diff then raise exception 'Omborda faqat % dona bor', coalesce(v_have,0); end if;
    update products set qty = qty - v_diff where id = it.product_id;
    insert into stock_moves (product_id, delta, reason, user_id, ref) values (it.product_id, -v_diff, 'tuzatish', auth.uid(), 'sotuv ' || s.no);
  end if;
  update sale_items set qty = p_qty, price_uzs = round(p_price), list_price_uzs = greatest(coalesce(list_price_uzs, price_uzs), round(p_price)) where id = p_item;
  v_old_total := s.total_uzs;
  select coalesce(sum(qty * price_uzs),0) into v_total from sale_items where sale_id = s.id;
  update sales set total_uzs = v_total where id = s.id;
  if s.pay = 'nasiya' then
    update customer_debts set amount_uzs = greatest(0, amount_uzs + (v_total - v_old_total)) where sale_id = s.id;
  end if;
  return jsonb_build_object('total_uzs', v_total);
end $$;

-- Sotuvning to'lov turi va sana-vaqtini o'zgartirish
create or replace function owner_sale_edit(p_sale uuid, p_pay text, p_ts timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  select * into s from sales where id = p_sale for update;
  if not found then raise exception 'Sotuv topilmadi'; end if;
  if p_pay is not null and p_pay <> s.pay then
    if p_pay = 'nasiya' or s.pay = 'nasiya' then raise exception 'Nasiyaga yoki nasiyadan o''zgartirib bo''lmaydi — vazvrat qilib qayta soting'; end if;
    if p_pay not in ('naqd','karta','otkazma') then raise exception 'To''lov turi noto''g''ri'; end if;
  end if;
  update sales set pay = coalesce(p_pay, pay), created_at = coalesce(p_ts, created_at) where id = p_sale;
end $$;

-- Sotuvni butunlay bekor qilish (tovarlar omborga qaytadi)
create or replace function owner_sale_delete(p_sale uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s sales; r record;
begin
  if not is_owner() then raise exception 'Faqat rahbar'; end if;
  select * into s from sales where id = p_sale for update;
  if not found then raise exception 'Sotuv topilmadi'; end if;
  if exists (select 1 from customer_debts d where d.sale_id = p_sale and exists (select 1 from customer_payments cp where cp.debt_id = d.id)) then
    raise exception 'Bu nasiya bo''yicha to''lovlar bor — avval to''lovlarni o''chiring';
  end if;
  for r in select i.product_id, i.qty - coalesce((select sum(qty) from sale_returns x where x.item_id = i.id),0) as q
           from sale_items i where i.sale_id = p_sale loop
    if r.product_id is not null and r.q > 0 then
      update products set qty = qty + r.q where id = r.product_id;
      insert into stock_moves (product_id, delta, reason, user_id, ref) values (r.product_id, r.q, 'tuzatish', auth.uid(), 'bekor ' || s.no);
    end if;
  end loop;
  delete from customer_debts where sale_id = p_sale;
  delete from sales where id = p_sale;
end $$;

revoke execute on function owner_product_save(jsonb), owner_product_delete(uuid), owner_move_edit(bigint,int),
  owner_sale_item_edit(bigint,int,numeric), owner_sale_edit(uuid,text,timestamptz), owner_sale_delete(uuid) from anon, public;
grant execute on function owner_product_save(jsonb), owner_product_delete(uuid), owner_move_edit(bigint,int),
  owner_sale_item_edit(bigint,int,numeric), owner_sale_edit(uuid,text,timestamptz), owner_sale_delete(uuid) to authenticated;
