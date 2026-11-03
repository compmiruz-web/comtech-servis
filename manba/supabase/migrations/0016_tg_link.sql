-- Bot: mijoz raqamini bazadan tez topish (1000 tadan ko'p mijoz bo'lsa ham) va yo'q bo'lsa qo'shish
create index if not exists clients_phone_key_idx on clients (right(regexp_replace(phone, '\D', '', 'g'), 9));
create or replace function tg_link(p_phone text, p_chat bigint, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 9); v_name text; v_n int;
begin
  if length(v_key) < 9 then return jsonb_build_object('ok', false); end if;
  update clients set tg_chat_id = p_chat where right(regexp_replace(phone, '\D', '', 'g'), 9) = v_key;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    insert into clients (phone, name, tg_chat_id) values ('+998' || v_key, coalesce(nullif(trim(p_name), ''), '+998' || v_key), p_chat)
    on conflict (phone) do update set tg_chat_id = excluded.tg_chat_id;
    return jsonb_build_object('ok', true, 'found', false, 'name', coalesce(nullif(trim(p_name), ''), ''));
  end if;
  select name into v_name from clients where right(regexp_replace(phone, '\D', '', 'g'), 9) = v_key order by created_at limit 1;
  return jsonb_build_object('ok', true, 'found', true, 'name', v_name, 'count', v_n);
end $$;
revoke execute on function tg_link(text,bigint,text) from anon, authenticated, public;
grant execute on function tg_link(text,bigint,text) to service_role;
