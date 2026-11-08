-- Ustaxona nazorati: qabul qilingan / diagnostikadagi qurilmalar bo'yicha guruhga so'rov
-- ask_next_at  — keyingi so'rov vaqti (null = so'ralmaydi)
-- ask_msg_id   — guruhdagi oxirgi so'rov xabari (qayta yuborilganda eskisi o'chiriladi)
-- ask_count    — necha marta so'raldi (javobsiz)
-- status_at    — holat oxirgi marta o'zgargan vaqt
alter table repairs add column if not exists ask_next_at timestamptz;
alter table repairs add column if not exists ask_msg_id  bigint;
alter table repairs add column if not exists ask_count   int not null default 0;
alter table repairs add column if not exists status_at   timestamptz;

update repairs set status_at = coalesce(done_at, created_at) where status_at is null;
-- Hozir servisda turganlar darhol so'raladi
update repairs set ask_next_at = now() where status in ('qabul', 'diag') and ask_next_at is null;

create index if not exists repairs_ask_idx on repairs (ask_next_at) where ask_next_at is not null;

create or replace function repairs_before_update() returns trigger
language plpgsql as $$
begin
  if new.status = 'berildi' and old.status <> 'berildi' then new.done_at := now(); end if;
  if new.status <> 'berildi' then new.done_at := null; end if;
  -- xodim talon raqami, qabul sanasi va qabul qilgan xodimni o'zgartira olmaydi
  if not is_owner() and not is_service() then
    new.talon := old.talon; new.created_at := old.created_at; new.accepted_by := old.accepted_by;
  end if;
  -- asosiy raqam o'zgarsa, eskisi "eski raqam" bo'lib saqlanadi
  if new.client_phone is distinct from old.client_phone and new.client_phone_old is not distinct from old.client_phone_old then
    new.client_phone_old := old.client_phone;
  end if;
  -- holat o'zgarsa: guruhdagi so'rov qaytadan rejalashtiriladi
  if new.status is distinct from old.status then
    new.status_at := now();
    new.ask_count := 0;
    new.ask_next_at := case new.status
      when 'qabul' then now() + interval '30 minutes'
      when 'diag'  then now() + interval '2 hours'   -- diagnostikada 2 soatdan oshsa natijasini so'raydi
      else null end;
  end if;
  return new;
end $$;

-- Yangi talon: 30 daqiqadan keyin birinchi so'rov
create or replace function repairs_before_insert_ask() returns trigger
language plpgsql as $$
begin
  new.status_at := coalesce(new.status_at, now());
  if new.status in ('qabul', 'diag') and new.ask_next_at is null then
    new.ask_next_at := now() + interval '30 minutes';
  end if;
  return new;
end $$;
drop trigger if exists repairs_bi_ask on repairs;
create trigger repairs_bi_ask before insert on repairs for each row execute function repairs_before_insert_ask();
