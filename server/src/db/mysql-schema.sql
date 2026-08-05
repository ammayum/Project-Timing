create table if not exists employees (
  id bigint auto_increment primary key,
  sso_id varchar(255) not null unique,
  name varchar(255) not null,
  email varchar(255) not null unique,
  ein varchar(255),
  role varchar(50) not null default 'employee',
  team_id bigint null,
  overtime_allowed boolean not null default false,
  working_hours_per_day decimal(4,2) not null default 7.50,
  is_admin boolean not null default false,
  created_at timestamp not null default current_timestamp
);

create table if not exists teams (
  id bigint auto_increment primary key,
  name varchar(255) not null unique,
  description text null,
  created_at timestamp not null default current_timestamp
);

create table if not exists projects (
  id bigint auto_increment primary key,
  Ja_Code varchar(255) not null,
  Project_Name varchar(255) not null,
  FD_Ref varchar(255) null,
  Status varchar(50) not null default 'active',
  Channel varchar(255) null,
  Project_Description text null,
  Company varchar(255) null,
  Suffix varchar(255) not null default '',
  unique key uniq_project_code_suffix (Ja_Code, Suffix)
);

create table if not exists activity_types (
  id bigint auto_increment primary key,
  name varchar(255) not null unique
);

create table if not exists time_entries (
  id bigint auto_increment primary key,
  employee_id bigint not null,
  activity_type_id bigint not null,
  project_id bigint null,
  order_num varchar(255) null,
  entry_date date not null,
  from_time time not null,
  to_time time not null,
  hours decimal(5, 2) not null,
  overtime boolean not null default false,
  created_at timestamp not null default current_timestamp,
  foreign key (employee_id) references employees(id) on delete cascade,
  foreign key (activity_type_id) references activity_types(id),
  foreign key (project_id) references projects(id)
);

create table if not exists kits (
  id bigint auto_increment primary key,
  project_id bigint null,
  project_ja_code varchar(255) null,
  part_code varchar(255) not null default '',
  serial_number varchar(255) not null default '',
  device_type varchar(255),
  brand varchar(255),
  model varchar(255),
  unique key uniq_kit_codes (part_code, serial_number),
  foreign key (project_id) references projects(id) on delete set null
);

create table if not exists time_entry_kits (
  time_entry_id bigint not null,
  kit_id bigint not null,
  primary key (time_entry_id, kit_id),
  foreign key (time_entry_id) references time_entries(id) on delete cascade,
  foreign key (kit_id) references kits(id) on delete cascade
);

create table if not exists app_settings (
  `key` varchar(255) primary key,
  `value` text not null
);

create table if not exists stock_report (
  part_code varchar(50) null,
  serial_number varchar(50) null,
  product_name varchar(50) null,
  part_description varchar(50) null,
  user_group varchar(50) null,
  make varchar(50) null,
  model varchar(50) null
);

create table if not exists auth_sessions (
  id varchar(64) primary key,
  employee_id bigint not null,
  token_hash varchar(128) not null unique,
  created_at timestamp not null,
  last_activity_at timestamp not null,
  revoked_at timestamp null,
  revoke_reason varchar(64) null,
  foreign key (employee_id) references employees(id) on delete cascade
);

create table if not exists project_teams (
  project_id bigint not null,
  team_id bigint not null,
  primary key (project_id, team_id)
);

create table if not exists project_managers (
  project_id bigint not null,
  employee_id bigint not null,
  assignment_role varchar(100) not null default 'Manager',
  primary key (project_id, employee_id)
);

insert ignore into activity_types (name) values ('Project'), ('Admin'), ('Education'), ('Meeting');
insert ignore into app_settings (`key`, `value`) values ('sharepoint_sync_enabled', 'false');
