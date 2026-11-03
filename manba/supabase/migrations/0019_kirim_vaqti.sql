-- Tovarning oxirgi kirim vaqti (ombor ro'yxatida yangi kelganlar tepada turishi uchun)
alter table products add column if not exists last_in timestamptz;
update products p set last_in = coalesce((select max(m.created_at) from stock_moves m where m.product_id = p.id and m.delta > 0 and m.reason = 'kirim'), p.created_at)
where last_in is null;
alter table products alter column last_in set default now();

create or replace function stock_moves_last_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.delta > 0 and new.reason = 'kirim' then update products set last_in = new.created_at where id = new.product_id; end if;
  return new;
end $$;
drop trigger if exists stock_moves_last_in_ai on stock_moves;
create trigger stock_moves_last_in_ai after insert on stock_moves for each row execute function stock_moves_last_in();
