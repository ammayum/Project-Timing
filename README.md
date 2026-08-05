<<<<<<< HEAD
# Project-Timing
Project-Timing
=======
# Project Billing System

Project Billing System is a React + Express application for:

- daily time entry
- project and kit tracking
- employee, team, and manager administration
- controlled project visibility by team and manager assignment

## Current State

The app currently supports:

- username/email + password login
- admin-created users with temporary password reset flow
- forced password change on first login
- team management
- many-to-many manager-to-project assignment
- team-based project visibility for employees
- manager visibility into projects they manage
- MySQL-backed runtime with PostgreSQL schema assets still present in the repo

The dual-database operating mode design discussed for MySQL/PostgreSQL concurrency is not implemented yet. It should be treated as planned design work only.

## Structure

```text
client/   React application
server/   Express API, repositories, and database schema files
```

## Prerequisites

- Node.js 24+
- MySQL 8+ for the current runtime path
- PostgreSQL 14+ only if you want to inspect or evolve the PostgreSQL schema files

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create an environment file from `.env.example` if present, or create your own `.env` with the required DB and auth values.

3. Initialize the active database.

For the current app behavior, the important schema file is:

- [server/src/db/mysql-schema.sql](/C:/Users/testpc/Desktop/office/server/src/db/mysql-schema.sql)

PostgreSQL schema assets also exist here:

- [server/src/db/schema.sql](/C:/Users/testpc/Desktop/office/server/src/db/schema.sql)

4. Start the app:

```bash
npm run dev
```

Default local addresses:

- frontend: `https://localhost:5173`
- backend: `http://localhost:4000`

## Authentication

The app currently supports local credential login through the API.

Session behavior:

- active users stay signed in until signout or 5 minutes of inactivity
- inactive sessions are revoked server-side and cleared client-side
- session data is stored in browser `sessionStorage`, not persistent `localStorage`

### Admin-managed password flow

- Admin can create a user from the Admin screen
- New users get an auto-generated temporary password
- User is forced to change password on first login
- Admin can reset an existing user to a newly generated temporary password

## Access Model

### Roles

- `admin`
- `manager`
- `employee`

### Teams

- Employees belong to zero or one team
- Admin assigns projects to one or more teams
- Employees only see projects assigned to their team

### Manager assignment

- A manager can manage multiple projects
- A project can have multiple managers
- Managers can see projects assigned to them

This is implemented as a relationship model, not a single manager field on the project.

## Admin Features

The current Admin area supports:

- create and update users
- assign users to teams
- reset user passwords
- create teams
- create or update projects
- assign multiple teams to a project
- assign multiple managers to a project
- create kits
- bulk import kits by CSV
- inspect database counts and MySQL status

## Project Visibility Rules

For non-admin users:

- time-entry project dropdown is filtered
- CSV preview validates only accessible projects
- time-entry save rejects inaccessible project codes

## API Overview

### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `POST /api/auth/microsoft`
- `POST /api/auth/set-password`  
  Dev-oriented route, not part of normal admin workflow

### Time Entries

- `GET /api/time-entries/meta`
- `GET /api/time-entries?date=YYYY-MM-DD`
- `POST /api/time-entries`
- `POST /api/time-entries/upload`

### Kits

- `POST /api/kits/resolve`
- `GET /api/kits/stock-report`

### Admin

- `GET /api/admin`
- `GET /api/admin/projects-with-kits`
- `GET /api/admin/performance`
- `POST /api/admin/users`
- `POST /api/admin/users/:id/reset-password`
- `PUT /api/admin/employees/:id`
- `POST /api/admin/teams`
- `POST /api/admin/projects`
- `POST /api/admin/kits`
- `POST /api/admin/kits/upload`
- `GET /api/admin/db`
- `GET /api/admin/mysql`
- `POST /api/admin/mysql/init`

## Notes

- Time-entry rules enforce overlap prevention and the 7.5-hour daily threshold unless overtime is enabled.
- The frontend protects against mixed-content API configuration by falling back to same-origin `/api` when the page is served over HTTPS and an insecure API base URL is configured.
- Some older README references to Google Sheets, Microsoft Graph, SharePoint sync, and PostgreSQL-first runtime are no longer an accurate description of the current app behavior.

## Production Deployment

The supported pilot deployment is a Linux VM with Nginx serving `client/dist` and reverse-proxying `/api` to the Node API. MySQL is the only production primary/write database. PostgreSQL may remain configured for inspection or replication work, but it is not promoted to the production write path by this release.

1. Copy `.env.example` to the server environment file and replace every placeholder.
2. Set `NODE_ENV=production`, a unique 32+ character `JWT_SECRET`, the public `FRONTEND_ORIGINS`, and real MySQL credentials.
3. Build the client with `npm run build` and run the database migration with `npm run migrate:mysql --workspace server`.
4. Confirm `GET /api/ready` returns HTTP 200 before enabling the Nginx site.
5. Install [deploy/nginx/project-billing-system.conf](/C:/Users/testpc/Desktop/office/deploy/nginx/project-billing-system.conf) and [deploy/systemd/project-billing-system.service](/C:/Users/testpc/Desktop/office/deploy/systemd/project-billing-system.service).

Production startup fails when required security or MySQL configuration is missing, when MySQL is not the active write primary, or when the required schema is unavailable. See the [production runbook](/C:/Users/testpc/Desktop/office/docs/production-runbook.md) for TLS, backups, rollback, monitoring, and incident response.

## Admin Technical Document

For detailed admin/operator guidance, see:

- [docs/admin-technical-guide.md](/C:/Users/testpc/Desktop/office/docs/admin-technical-guide.md)
- [docs/database-dual-runtime-design.md](/C:/Users/testpc/Desktop/office/docs/database-dual-runtime-design.md)
- [docs/timesheet-technical-guide.md](/C:/Users/testpc/Desktop/office/docs/timesheet-technical-guide.md)
- [docs/timesheet-user-manual.md](/C:/Users/testpc/Desktop/office/docs/timesheet-user-manual.md)
>>>>>>> 461be19 (First To Git)
