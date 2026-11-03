-- Talonda qo'shimcha raqam va eski raqam
alter table repairs add column if not exists client_phone2 text;
alter table repairs add column if not exists client_phone_old text;

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
  return new;
end $$;

create or replace function intake_repair(p jsonb) returns repairs
language plpgsql security definer set search_path = public as $$
declare v_talon int; r repairs;
begin
  if not is_staff() then raise exception 'Ruxsat yo''q'; end if;
  update settings set next_talon = next_talon + 1 where id = 1 returning next_talon - 1 into v_talon;
  insert into clients (phone, name) values (p->>'phone', p->>'name')
  on conflict (phone) do update set name = excluded.name;
  insert into repairs (talon, client_phone, client_name, device, model, serial, problem, accessories, fee_uzs, master_id, accepted_by, client_phone2)
  values (v_talon, p->>'phone', p->>'name', p->>'device', p->>'model', p->>'serial', p->>'problem', p->>'accessories',
          coalesce((p->>'fee_uzs')::numeric, 0), nullif(p->>'master_id','')::uuid, auth.uid(), nullif(regexp_replace(coalesce(p->>'phone2',''), '[\s-]', '', 'g'), ''))
  returning * into r;
  return r;
end $$;

-- Jumavoy (talon 1162): xato yozilgan raqam (firma raqami) o'rniga mijozning o'z raqami; eskisi "eski raqam"da qoladi
update repairs set client_phone = '+998938842323' where talon = 1162 and client_phone = '+998972100515';
delete from clients c where c.phone = '+998972100515' and c.name = 'Jumavoy'
  and not exists (select 1 from repairs r where r.client_phone = c.phone)
  and not exists (select 1 from customer_debts d where d.client_phone = c.phone);
