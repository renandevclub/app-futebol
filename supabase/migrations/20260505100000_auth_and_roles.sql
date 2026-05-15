create table if not exists public.profiles (
  id uuid references auth.users on delete cascade,
  name text,
  role text default 'user',
  primary key (id)
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "Admin can view all" on public.profiles;
create policy "Admin can view all"
on public.profiles
for select
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
);

-- Note: To allow users to update their own profile (if needed in the future)
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
using (auth.uid() = id);

-- Note: Admin full access
drop policy if exists "Admin full access" on public.profiles;
create policy "Admin full access"
on public.profiles
for all
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, new.raw_user_meta_data->>'name', 'user');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Criação do Admin User
DO $$
DECLARE
  admin_id uuid := gen_random_uuid();
  admin_email text := 'admin@admin.com';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = admin_email) THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at, 
      raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
    ) VALUES (
      admin_id, '00000000-0000-0000-0000-000000000000', admin_email, 
      crypt('123456', gen_salt('bf')), now(), 
      '{"provider":"email","providers":["email"]}', 
      '{"name":"Renan Lima"}', 
      'authenticated', 'authenticated', now(), now()
    );

    -- O trigger cuidará de inserir na profiles. Mas como é async/imediato, precisamos 
    -- apenas atualizar a role para admin logo depois:
    UPDATE public.profiles SET role = 'admin' WHERE id = admin_id;
  END IF;
END $$;

