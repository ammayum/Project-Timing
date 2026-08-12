create table if not exists employees (
  id bigserial primary key,
  sso_id text not null unique,
  name text not null,
  email text not null unique,
  ein text,
  role text not null default 'employee',
  team_id bigint,
  overtime_allowed boolean not null default false,
  working_hours_per_day numeric(4,2) not null default 7.50,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id bigserial primary key,
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id bigserial primary key,
  "Ja_Code" text not null,
  "Project_Name" text not null,
  "FD_Ref" text,
  "Status" text not null default 'active',
  "Channel" text,
  "Project_Description" text,
  "Company" text,
  "Suffix" text not null default '',
  unique ("Ja_Code", "Suffix")
);

create table if not exists activity_types (
  id bigserial primary key,
  name text not null unique
);

create table if not exists time_entries (
  id bigserial primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  activity_type_id bigint not null references activity_types(id),
  project_id bigint references projects(id),
  order_num text,
  entry_date date not null,
  from_time time not null,
  to_time time not null,
  hours numeric(5, 2) not null,
  overtime boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists kits (
  id bigserial primary key,
  project_id bigint references projects(id) on delete set null,
  project_ja_code text,
  part_code text not null default '',
  serial_number text not null default '',
  device_type text,
  brand text,
  model text,
  unique (part_code, serial_number)
);

alter table employees add column if not exists role text not null default 'employee';
alter table kits add column if not exists project_id bigint references projects(id) on delete set null;
alter table kits add column if not exists project_ja_code text;
alter table time_entries add column if not exists order_num text;

create table if not exists time_entry_kits (
  time_entry_id bigint not null references time_entries(id) on delete cascade,
  kit_id bigint not null references kits(id) on delete cascade,
  primary key (time_entry_id, kit_id)
);

create table if not exists app_settings (
  key text primary key,
  value text not null
);

create table if not exists stock_report (
  part_code text,
  serial_number text,
  product_name text,
  part_description text,
  user_group text,
  make text,
  model text
);

create table if not exists auth_sessions (
  id text primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null,
  last_activity_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text
);

create table if not exists kit_stock_update_audit (
  id bigserial primary key,
  actor_employee_id bigint not null references employees(id) on delete restrict,
  kit_id bigint not null references kits(id) on delete restrict,
  part_code text,
  serial_number text,
  matched_by text not null,
  old_values jsonb not null,
  new_values jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists project_teams (
  project_id bigint not null references projects(id) on delete cascade,
  team_id bigint not null references teams(id) on delete cascade,
  primary key (project_id, team_id)
);

create table if not exists project_managers (
  project_id bigint not null references projects(id) on delete cascade,
  employee_id bigint not null references employees(id) on delete cascade,
  assignment_role text not null default 'Manager',
  primary key (project_id, employee_id)
);

insert into activity_types (name)
values ('Project'), ('Admin'), ('Education'), ('Meeting')
on conflict (name) do nothing;

insert into app_settings (key, value)
values ('sharepoint_sync_enabled', 'false')
on conflict (key) do nothing;
