-- Tovar bo'limlari (yo'nalishlar) endi rahbar tomonidan qo'lda yaratiladi: cheklovni olib tashlaymiz
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.products'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%line%' loop
    execute format('alter table products drop constraint %I', c);
  end loop;
end $$;
alter table products add constraint products_line_nonempty check (length(trim(line)) > 0);
