-- Oylik berish tarixi + rahbar uchun bildirishnomalar (kunlik va oylik foyda/zarar)

-- Xodim o'ziga berilgan oyliklarni ko'ra oladi (oylikni ko'rish ruxsati bo'lsa)
drop policy if exists exp_read_salary on expenses;
create policy exp_read_salary on expenses for select to authenticated using (
  cat = 'oylik' and to_user = auth.uid()
  and exists (select 1 from profiles where id = auth.uid() and see_salary and active)
  and coalesce((select (mods->>'salary')::boolean from settings where id = 1), false));
alter table expenses add column if not exists pay text;   -- naqd / karta

create table if not exists notifications (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,                 -- day | month | salary | info
  level text not null default 'info', -- good | bad | info
  title text not null,
  body text not null default '',
  ref text unique,
  read boolean not null default false
);
alter table notifications enable row level security;
grant select, update, delete on notifications to authenticated;
grant all on notifications to service_role;
grant usage on sequence notifications_id_seq to service_role;
drop policy if exists notif_read on notifications;
drop policy if exists notif_upd on notifications;
drop policy if exists notif_del on notifications;
create policy notif_read on notifications for select to authenticated using (is_owner());
create policy notif_upd  on notifications for update to authenticated using (is_owner()) with check (is_owner());
create policy notif_del  on notifications for delete to authenticated using (is_owner());
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when others then null; end $$;

create or replace function fmt_uzs(n numeric) returns text language sql immutable as $$
  select (case when n < 0 then '−' else '' end) || trim(replace(to_char(abs(round(coalesce(n,0))), 'FM999G999G999G999'), ',', ' ')) || ' so''m'
$$;

-- Oy bo'yicha xulosa (oy boshidan bugungacha)
create or replace function month_summary(p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date; d0 date; d1 date; j jsonb; r jsonb := '{}'::jsonb;
  rev numeric := 0; ret numeric := 0; prof numeric := 0; rep numeric := 0; exp numeric := 0; sal numeric := 0; cnt int := 0;
begin
  if not (is_owner() or is_service()) then raise exception 'Faqat rahbar'; end if;
  d0 := to_date(p_month || '-01', 'YYYY-MM-DD');
  d1 := least((d0 + interval '1 month' - interval '1 day')::date, (now() at time zone 'Asia/Tashkent')::date);
  d := d0;
  while d <= d1 loop
    j := day_summary(d);
    rev := rev + (j->>'revenue')::numeric; ret := ret + coalesce((j->>'returns')::numeric, 0);
    prof := prof + (j->>'profit')::numeric; rep := rep + (j->>'repair_income')::numeric;
    exp := exp + (j->>'expenses')::numeric; cnt := cnt + (j->>'sales_count')::int;
    d := d + 1;
  end loop;
  select coalesce(sum(amount_uzs), 0) into sal from expenses where cat = 'oylik' and to_char(tz_day(created_at), 'YYYY-MM') = p_month;
  return jsonb_build_object('month', p_month, 'days', greatest(d1 - d0 + 1, 0), 'sales_count', cnt,
    'revenue', rev, 'returns', ret, 'profit', prof, 'repair_income', rep,
    'expenses', exp, 'salary', sal, 'other_expenses', exp - sal,
    'net', prof + rep - exp);
end $$;

-- Oylik berilganda bildirishnoma
create or replace function notif_salary() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cat = 'oylik' then
    insert into notifications (kind, level, title, body, ref)
    values ('salary', 'info',
      '💸 Oylik berildi: ' || coalesce((select name from profiles where id = new.to_user), '—'),
      fmt_uzs(new.amount_uzs) || ' · ' || to_char(new.created_at at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI')
        || coalesce(' · ' || nullif(new.pay, ''), '') || coalesce(' · ' || nullif(new.note, ''), ''),
      'salary:' || new.id)
    on conflict (ref) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists expenses_notif on expenses;
create trigger expenses_notif after insert on expenses for each row execute function notif_salary();

-- Har kuni kechqurun: bugungi va oy boshidan foyda/zarar; oyning oxirgi kuni — oy yakuni
create or replace function notify_daily(p_day date default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_day date := coalesce(p_day, (now() at time zone 'Asia/Tashkent')::date);
  dj jsonb; mj jsonb; dnet numeric; m text := to_char(v_day, 'YYYY-MM'); body text;
  mnames text[] := array['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
  mname text;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  dj := day_summary(v_day);
  mj := month_summary(m);
  mname := mnames[extract(month from v_day)::int];
  dnet := (dj->>'profit')::numeric + (dj->>'repair_income')::numeric - (dj->>'expenses')::numeric;
  body := 'Bugun: tushum ' || fmt_uzs((dj->>'revenue')::numeric) || ', foyda ' || fmt_uzs((dj->>'profit')::numeric)
    || ', remont ' || fmt_uzs((dj->>'repair_income')::numeric) || ', rasxod ' || fmt_uzs((dj->>'expenses')::numeric)
    || ' → ' || fmt_uzs(dnet) || E'\n' || mname || ' boshidan: foyda ' || fmt_uzs((mj->>'profit')::numeric)
    || ', remont ' || fmt_uzs((mj->>'repair_income')::numeric) || ', rasxod ' || fmt_uzs((mj->>'other_expenses')::numeric)
    || ', oylik ' || fmt_uzs((mj->>'salary')::numeric) || ' → ' || fmt_uzs((mj->>'net')::numeric);
  insert into notifications (kind, level, title, body, ref)
  values ('day', case when (mj->>'net')::numeric >= 0 then 'good' else 'bad' end,
    to_char(v_day, 'DD.MM') || ': ' || mname || ' oyida ' || case when (mj->>'net')::numeric >= 0 then 'plyusdasiz ✅ ' else 'minusdasiz 🔻 ' end || fmt_uzs((mj->>'net')::numeric),
    body, 'day:' || v_day)
  on conflict (ref) do update set title = excluded.title, body = excluded.body, level = excluded.level, created_at = now(), read = false;

  if v_day = (date_trunc('month', v_day) + interval '1 month' - interval '1 day')::date then
    insert into notifications (kind, level, title, body, ref)
    values ('month', case when (mj->>'net')::numeric >= 0 then 'good' else 'bad' end,
      '📊 ' || mname || ' oyi yakuni: ' || case when (mj->>'net')::numeric >= 0 then 'PLYUS ' else 'MINUS ' end || fmt_uzs((mj->>'net')::numeric),
      'Sotuv: ' || (mj->>'sales_count') || ' ta, tushum ' || fmt_uzs((mj->>'revenue')::numeric) || E'\n'
      || 'Savdo foydasi: ' || fmt_uzs((mj->>'profit')::numeric) || E'\n'
      || 'Remont daromadi: ' || fmt_uzs((mj->>'repair_income')::numeric) || E'\n'
      || 'Rasxodlar: ' || fmt_uzs((mj->>'other_expenses')::numeric) || E'\n'
      || 'Oyliklar: ' || fmt_uzs((mj->>'salary')::numeric) || E'\n'
      || 'Sof natija: ' || fmt_uzs((mj->>'net')::numeric),
      'month:' || m)
    on conflict (ref) do update set title = excluded.title, body = excluded.body, level = excluded.level, created_at = now(), read = false;
  end if;
  return 'ok';
end $$;

revoke execute on function month_summary(text), notify_daily(date) from anon, public;
grant execute on function month_summary(text) to authenticated;

-- Har kuni 21:05 (Toshkent) — UTC 16:05
do $$ begin perform cron.unschedule('comtech-notify'); exception when others then null; end $$;
select cron.schedule('comtech-notify', '5 16 * * *', $$select public.notify_daily()$$);
