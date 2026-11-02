-- Talondagi mijoz telefoni va ismini xodimlar ham, rahbar ham o'zgartira oladi
create or replace function repairs_before_update() returns trigger
language plpgsql as $$
begin
  if new.status = 'berildi' and old.status <> 'berildi' then new.done_at := now(); end if;
  if new.status <> 'berildi' then new.done_at := null; end if;
  -- xodim talon raqami, qabul sanasi va qabul qilgan xodimni o'zgartira olmaydi
  if not is_owner() and not is_service() then
    new.talon := old.talon; new.created_at := old.created_at; new.accepted_by := old.accepted_by;
  end if;
  return new;
end $$;
