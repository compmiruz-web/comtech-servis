-- Soat sozlamasi: vaqt mintaqasi va qo'lda tuzatish; server vaqti
alter table settings add column if not exists clock jsonb not null default '{"tz":"Asia/Tashkent","adj":0,"sync":true}'::jsonb;
create or replace function server_now() returns timestamptz language sql stable as $$ select now() $$;
revoke execute on function server_now() from anon;
grant execute on function server_now() to authenticated;

-- Chegirma chegarasi: foizda (pct), so'mda (uzs) yoki dollarda (usd) — 1 dona uchun eng ko'p tushirish
create or replace function disc_max_uzs(p_rule jsonb, p_list numeric, p_rate numeric) returns numeric
language sql immutable as $$
  select case
    when p_rule is null then 0
    when jsonb_typeof(p_rule) = 'number' then p_list * (p_rule::text)::numeric / 100
    when p_rule->>'type' = 'uzs' then coalesce((p_rule->>'v')::numeric, 0)
    when p_rule->>'type' = 'usd' then coalesce((p_rule->>'v')::numeric, 0) * p_rate
    else p_list * coalesce((p_rule->>'v')::numeric, 0) / 100 end
$$;

create or replace function make_sale(p_items jsonb, p_pay text, p_client text default null, p_date date default null,
  p_client_name text default null, p_due date default null, p_prepaid numeric default 0, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric; v_sale uuid; v_no bigint; v_total numeric := 0; v_ts timestamptz := day_ts(p_date);
  it jsonb; p products%rowtype; v_qty int; v_price numeric; v_list numeric; v_disc jsonb; v_lim numeric; v_owner boolean := is_owner(); v_item bigint; v_cost numeric;
  v_phone text := nullif(regexp_replace(coalesce(p_client,''), '\s', '', 'g'), ''); v_debt uuid; v_cr jsonb; v_open numeric;
begin
  if not is_staff() then raise exception 'Ruxsat yo''q'; end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then raise exception 'Savat bo''sh'; end if;
  select rate, credit, coalesce(discount, '{}'::jsonb) into v_rate, v_cr, v_disc from settings where id = 1;
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
    v_list := coalesce(p.sell_uzs, price_uzs(p.sell_usd, v_rate));
    v_price := v_list;
    if nullif(it->>'price', '') is not null and (it->>'price')::numeric <> v_list then
      v_price := round((it->>'price')::numeric);
      if v_price > v_list then raise exception '%: narx asl narxdan (% so''m) yuqori bo''lmasin', p.name, v_list; end if;
      if v_price < 0 then raise exception 'Narx noto''g''ri'; end if;
      if not can_discount() then raise exception 'Narx tushirishga ruxsat yo''q'; end if;
      if not v_owner then
        v_lim := disc_max_uzs(v_disc->p.line, v_list, v_rate);
        if v_list - v_price > v_lim + 0.5 then
          raise exception '%: ko''pi bilan % so''m tushirish mumkin (eng kam narx % so''m)', p.name, round(v_lim), v_list - floor(v_lim);
        end if;
      end if;
    end if;
    insert into sale_items (sale_id, product_id, name, line, qty, price_uzs, list_price_uzs)
    values (v_sale, p.id, p.name, p.line, v_qty, v_price, v_list) returning id into v_item;
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
