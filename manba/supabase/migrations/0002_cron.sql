-- Avtomatik ishlar: har 5 daqiqada "tick" funksiyasi chaqiriladi.
-- Maxfiy kalitlarni baza o'zi tasodifiy yaratadi (hech kim terib kiritmaydi).
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table settings add column if not exists webhook_ok boolean not null default false;

select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'cron_secret')
where not exists (select 1 from vault.secrets where name = 'cron_secret');
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'tg_webhook_secret')
where not exists (select 1 from vault.secrets where name = 'tg_webhook_secret');

-- Server funksiyalari kalitni tekshiradi (faqat service_role)
create or replace function secret_ok(p_name text, p_val text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select p_val <> '' and exists (select 1 from vault.decrypted_secrets where name = p_name and decrypted_secret = p_val)
$$;
create or replace function webhook_secret() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'tg_webhook_secret'
$$;
revoke execute on function secret_ok(text, text), webhook_secret() from public, anon, authenticated;
grant execute on function secret_ok(text, text), webhook_secret() to service_role;

select cron.unschedule('comtech-tick') where exists (select 1 from cron.job where jobname = 'comtech-tick');
select cron.schedule('comtech-tick', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://ufdvanyjmfyjrdhrnalz.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);
