-- =====================================================================
--  MOTIVATION MOJO DOJO — Supabase schema, security and functions
--  Paste this whole file into Supabase → SQL Editor → Run.
--  Safe to re-run: every object is created "if not exists" / "or replace".
--
--  Rules (Epic/Minimum lines, week start, rewards) are NOT in here.
--  They live in mojo/app.js so the guide board and the kid page can't disagree.
--  This file only stores raw Timeback numbers and the guide's marks.
--
--  No student names, emails, tokens or keys are written in this file.
--  Names and emails arrive from Timeback through mojo_sync, or are typed
--  by a guide on /house/guide, and live only in the database.
-- =====================================================================

-- ---------- tables ---------------------------------------------------

-- Who counts as a guide. Add rows in the SQL editor (see README step 3).
create table if not exists public.guides (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now()
);

-- Class-wide settings (which Timeback class to sync, last sync info).
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per kid. Timeback id is the key; everything a guide sets lives here.
create table if not exists public.kids (
  id                    text primary key,          -- Timeback sourcedId
  timeback_name         text,                      -- from sync, never typed in code
  display_name          text,                      -- guide's choice for the board
  email                 text unique check (email is null or email = lower(email)),
  email_source          text not null default 'missing'
                        check (email_source in ('timeback','manual','check','missing')),
  hidden                boolean not null default false,
  active                boolean not null default true,   -- false = left the class
  rings_off             text[]  not null default '{}',   -- subjects whose ring doesn't count
  language_with_reading boolean not null default false,
  open_subjects         text[]  not null default '{}',   -- subjects with an app (from sync)
  goals                 jsonb   not null default '{}',   -- latest Timeback daily goals {subject: xp}
  focus                 text,                            -- "My focus" line on the kid page
  fun_fact              text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Raw Timeback numbers, one row per kid per calendar date (weekends included;
-- app.js folds Saturday and Sunday into Friday).
create table if not exists public.days (
  kid_id     text not null references public.kids(id) on delete cascade,
  day        date not null,
  subjects   jsonb not null default '{}',  -- {subject: {xp, questions, correct, minutes}}
  goals      jsonb not null default '{}',  -- daily goals that applied that day {subject: xp}
  tests      int   not null default 0,     -- tests finished in Timeback that day
  synced_at  timestamptz not null default now(),
  primary key (kid_id, day)
);

-- A guide's marks on one kid's day.
create table if not exists public.day_flags (
  kid_id     text not null references public.kids(id) on delete cascade,
  day        date not null,
  pass       boolean not null default false,  -- Day pass: rings may stay open
  test       boolean not null default false,  -- Test day: rings may stay open
  excused    boolean not null default false,  -- out of the smoothie / Fun Friday count
  apps_out   text[]  not null default '{}',   -- rings + goals removed for this kid, this day
  call_time  text,                            -- coaching call, e.g. "2:00"
  updated_at timestamptz not null default now(),
  primary key (kid_id, day)
);

-- Marks that apply to the whole class on one date.
create table if not exists public.class_days (
  day        date primary key,
  no_school  boolean not null default false,
  apps_out   text[]  not null default '{}',   -- App out → "All"
  updated_at timestamptz not null default now()
);

-- One row per sync, so the board can show "last synced".
create table if not exists public.sync_log (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  ran_by     text,
  kids       int,
  day_rows   int,
  note       text
);

create index if not exists days_day_idx on public.days(day);
create index if not exists day_flags_day_idx on public.day_flags(day);

-- ---------- townhall_is_guide() -------------------------------------
-- True when the signed-in Google account is on the guide list.
-- security definer so it can read guides even though guides is locked down.
create or replace function public.townhall_is_guide()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.guides g
    where g.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, true);
$$;

-- ---------- row level security --------------------------------------
-- Guides: full access to everything except the guide list itself.
-- Kids: NO direct table access at all. They only get house_card().
alter table public.guides     enable row level security;
alter table public.settings   enable row level security;
alter table public.kids       enable row level security;
alter table public.days       enable row level security;
alter table public.day_flags  enable row level security;
alter table public.class_days enable row level security;
alter table public.sync_log   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','kids','days','day_flags','class_days','sync_log'] loop
    execute format('drop policy if exists guide_all on public.%I', t);
    execute format(
      'create policy guide_all on public.%I for all to authenticated
         using (public.townhall_is_guide()) with check (public.townhall_is_guide())', t);
  end loop;
end $$;

-- Guides can see the guide list (read only). Add or remove guides in SQL.
drop policy if exists guide_read on public.guides;
create policy guide_read on public.guides for select to authenticated
  using (public.townhall_is_guide());

-- Nothing for the anon role, ever.
revoke all on all tables in schema public from anon;

-- ---------- mojo_sync(payload) --------------------------------------
-- Called by the guide board with what the Timeback sync collected.
-- payload = {
--   class:    {id, title},
--   students: [{id, name, email}],
--   goals:    {kidId: {subject: xp}},
--   open:     {kidId: [subject, ...]},
--   days:     [{kid, day:'YYYY-MM-DD', subjects:{subject:{xp,questions,correct,minutes}}, tests}]
-- }
create or replace function public.mojo_sync(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s        jsonb;
  d        jsonb;
  n_kids   int := 0;
  n_days   int := 0;
  ids      text[] := '{}';
  who      text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.townhall_is_guide() then
    raise exception 'only guides can sync' using errcode = '42501';
  end if;
  if jsonb_typeof(payload -> 'students') is distinct from 'array'
     or jsonb_array_length(payload -> 'students') = 0 then
    raise exception 'payload.students missing or empty';
  end if;

  -- kids: insert new ones, refresh Timeback fields, never touch guide fields
  for s in select * from jsonb_array_elements(payload -> 'students') loop
    ids := ids || (s ->> 'id');
    insert into public.kids as k (id, timeback_name, email, email_source, goals, open_subjects, active)
    values (
      s ->> 'id',
      s ->> 'name',
      nullif(lower(s ->> 'email'), ''),
      case when nullif(s ->> 'email', '') is null then 'missing' else 'timeback' end,
      coalesce(payload -> 'goals' -> (s ->> 'id'), '{}'),
      coalesce(array(select jsonb_array_elements_text(payload -> 'open' -> (s ->> 'id'))), '{}'),
      true
    )
    on conflict (id) do update set
      timeback_name = excluded.timeback_name,
      goals         = excluded.goals,
      open_subjects = excluded.open_subjects,
      active        = true,
      -- only fill the email from Timeback when a guide hasn't set one
      email         = case when k.email_source in ('missing','check') and excluded.email is not null
                           then excluded.email else k.email end,
      email_source  = case when k.email_source in ('missing','check') and excluded.email is not null
                           then 'timeback' else k.email_source end,
      updated_at    = now();
    n_kids := n_kids + 1;
  end loop;

  -- kids no longer on the roster drop off the board (rows are kept)
  update public.kids set active = false, updated_at = now()
  where active and not (id = any(ids));

  -- days: replace each synced kid-day with the fresh numbers
  for d in select * from jsonb_array_elements(coalesce(payload -> 'days', '[]')) loop
    if not ((d ->> 'kid') = any(ids)) then continue; end if;
    insert into public.days (kid_id, day, subjects, goals, tests, synced_at)
    values (
      d ->> 'kid',
      (d ->> 'day')::date,
      coalesce(d -> 'subjects', '{}'),
      coalesce(payload -> 'goals' -> (d ->> 'kid'), '{}'),
      coalesce((d ->> 'tests')::int, 0),
      now()
    )
    on conflict (kid_id, day) do update set
      subjects  = excluded.subjects,
      -- keep the goals a past day was judged on; only today's row takes new goals
      goals     = case when public.days.day >= current_date then excluded.goals else public.days.goals end,
      tests     = greatest(public.days.tests, excluded.tests),
      synced_at = now();
    n_days := n_days + 1;
  end loop;

  insert into public.settings (key, value, updated_at)
  values ('timeback_class', coalesce(payload -> 'class', '{}'), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  insert into public.sync_log (ran_by, kids, day_rows) values (who, n_kids, n_days);

  return jsonb_build_object('kids', n_kids, 'days', n_days, 'at', now());
end;
$$;

-- ---------- house_card(from, to) ------------------------------------
-- Everything one kid's page needs, for the signed-in kid only.
-- The kid is found by matching their Google email to kids.email.
-- Other kids appear only as anonymous week-XP numbers (for the Pizza bar).
create or replace function public.house_card(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me   public.kids;
  who  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if who = '' then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'date range too long';
  end if;

  select * into me from public.kids
  where email = who and active and not hidden;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'kid', jsonb_build_object(
      'id', me.id,
      'name', coalesce(me.display_name, split_part(me.timeback_name, ' ', 1)),
      'focus', me.focus,
      'fun_fact', me.fun_fact,
      'rings_off', to_jsonb(me.rings_off),
      'language_with_reading', me.language_with_reading,
      'open_subjects', to_jsonb(me.open_subjects),
      'goals', me.goals
    ),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'subjects', d.subjects, 'goals', d.goals, 'tests', d.tests) order by d.day)
      from public.days d
      where d.kid_id = me.id and d.day between p_from and p_to), '[]'),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', f.day, 'pass', f.pass, 'test', f.test, 'excused', f.excused,
        'apps_out', f.apps_out, 'call_time', f.call_time) order by f.day)
      from public.day_flags f
      where f.kid_id = me.id and f.day between p_from and p_to + 21), '[]'),
    'class_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', c.day, 'no_school', c.no_school, 'apps_out', c.apps_out) order by c.day)
      from public.class_days c
      where c.day between p_from and p_to), '[]'),
    -- anonymous: one week-XP total per visible classmate, no ids, no names
    'class_week_xp', coalesce((
      select jsonb_agg(t.xp order by t.xp)
      from (
        select k.id, coalesce(sum((v.value ->> 'xp')::numeric), 0) as xp
        from public.kids k
        left join public.days d on d.kid_id = k.id and d.day between p_from and p_to
        left join lateral jsonb_each(d.subjects) v on true
        where k.active and not k.hidden
        group by k.id
      ) t), '[]'),
    -- dates when EVERY kid on the board was excused (dates only, no names); lowers the Pizza goal
    'all_excused_days', coalesce((
      select jsonb_agg(e.day order by e.day)
      from (
        select f.day
        from public.day_flags f
        join public.kids k on k.id = f.kid_id and k.active and not k.hidden
        where f.excused and f.day between p_from and p_to
        group by f.day
        having count(distinct f.kid_id) = (select count(*) from public.kids where active and not hidden)
      ) e), '[]'),
    'synced_at', (select max(ran_at) from public.sync_log)
  );
end;
$$;

-- ---------- who may call what ---------------------------------------
revoke all on function public.townhall_is_guide()      from public, anon;
revoke all on function public.mojo_sync(jsonb)          from public, anon;
revoke all on function public.house_card(date, date)    from public, anon;
grant execute on function public.townhall_is_guide()    to authenticated;
grant execute on function public.mojo_sync(jsonb)       to authenticated;
grant execute on function public.house_card(date, date) to authenticated;

-- ---------- starting settings ---------------------------------------
-- Which Timeback class the sync looks for (matched against class titles).
insert into public.settings (key, value)
values ('class_match', '"L1"')
on conflict (key) do nothing;
