# Admin Technical Guide

## Purpose

This document is for system admins and technical operators working with Project Billing System.

It describes:

- current admin features
- access control behavior
- current database/runtime assumptions
- planned dual-database mode design

It does not assume developer-level familiarity with the codebase, but it does describe the system at an operational level.

## 1. Current Admin Responsibilities

Admin users currently manage:

- user creation
- password resets
- team creation
- employee-to-team assignment
- project creation
- project-to-team assignment
- project-to-manager assignment
- kit creation and CSV kit import

## 2. Current Access Control Model

### Roles

The application currently uses three roles:

- `admin`
- `manager`
- `employee`

### Teams

- Each employee can belong to one team
- Teams are created by admin
- Projects can be assigned to multiple teams

### Manager-to-project relationship

Projects do not store a single manager field.

Instead:

- one manager can be assigned to many projects
- one project can be assigned to many managers

This is the correct many-to-many model for future flexibility.

### Visibility rules

Employees never see all projects.

A non-admin user sees projects only if:

- the project is assigned to the user's team, or
- the user is directly assigned as a manager of that project

### Enforcement points

The project access rule is enforced in:

- time-entry dropdown metadata
- CSV validation preview
- time-entry submission

That means hidden projects are not just visually removed; they are blocked at API level too.

## 3. User Management

### Creating a new user

Admin can create a user from the Admin screen.

Current required fields:

- SSO ID / username
- full name
- email
- EIN
- role
- optional team
- overtime permission

### Default password flow

When a user is created:

- system generates a unique temporary password
- system marks the account as requiring password change

On first successful login:

- user is redirected to password-change screen
- user must set a new password before accessing the app

### Resetting a user password

Admin can reset any user password.

This does the following:

- password is reset to a newly generated temporary password
- account is marked `must change password`

## 4. Team Management

### What teams are for

Teams control project visibility for employees.

Typical pattern:

- create `Team X`
- create `Team Y`
- assign employees to one team
- assign projects to one or more teams

### Operational result

If Project A is assigned to Team X only:

- Team X employees can see it
- Team Y employees cannot

If Project B is assigned to Team X and Team Y:

- both teams can see it

## 5. Project Management

### Project assignment dimensions

A project now has three separate concerns:

1. project identity
2. assigned teams
3. assigned managers

### Why this matters

This model supports:

- one manager to many projects
- many managers to one project
- one team to many projects
- many teams to one project

without overloading the `projects` table with one-off columns.

## 6. Kit Management

Admin can:

- add a single kit manually
- bulk import kits via CSV

Kits can be associated with a project code.

## 7. Current Database Reality

### What is active today

The current runtime is effectively MySQL-oriented.

The repo still contains both:

- MySQL schema files
- PostgreSQL schema files

But the current application behavior and admin features are centered on the MySQL execution path.

### Important note

The system is not yet running true MySQL/PostgreSQL concurrent active mode.

That design has been discussed, but it is not implemented yet.

## 8. Planned Dual-Database Operating Mode

This section documents the agreed design direction only.

It should not be interpreted as already available.

### Goal

Allow admins to operate MySQL and PostgreSQL concurrently with explicit system modes:

1. `mysql_primary`
2. `postgres_primary`
3. `mysql_only`
4. `postgres_only`
5. `maintenance`

### Intended mode behavior

#### `mysql_primary`

- MySQL: read/write
- PostgreSQL: replicated, read-only

#### `postgres_primary`

- PostgreSQL: read/write
- MySQL: replicated, read-only

#### `mysql_only`

- MySQL: read/write
- PostgreSQL: disabled

#### `postgres_only`

- PostgreSQL: read/write
- MySQL: disabled

#### `maintenance`

- no writes to either DB

### Recommended design rules

- one primary write database at a time
- app-level replication to the secondary DB
- manual failover rather than automatic failover
- writes blocked during maintenance
- normal application reads should come from the current primary DB

### Why not native cross-engine replication

Because MySQL and PostgreSQL are different engines, the safer operational design is:

- application writes to primary
- outbox/sync queue replicates to secondary
- admin monitors lag and failures

## 9. Recommended Future Admin Controls for Dual-DB Mode

When this feature is implemented, the Admin area should expose:

- current selected mode
- MySQL connection state
- PostgreSQL connection state
- current write target
- sync lag
- failed sync count
- manual promote to MySQL primary
- manual promote to PostgreSQL primary
- maintenance mode toggle

## 10. Current Technical Risks and Notes

### Temporary password handling

Temporary passwords are now generated automatically per create/reset action.

Recommendation:

- deliver the generated password to the user through a secure out-of-band process

### Access model dependency

Because employee visibility depends on team assignment:

- an employee with no team may see no team-linked projects
- managers can still access projects directly assigned to them

### Validation

The admin employee update route has already been hardened to accept:

- blank EIN values
- null team values
- boolean-like MySQL round-tripped values such as `0` and `1`

## 11. Operational Checklist

### When onboarding a new employee

1. Create the user
2. Assign role
3. Assign team if applicable
4. Share temporary password securely
5. Confirm first login password change

### When onboarding a new project

1. Create the project
2. Assign one or more teams
3. Assign one or more managers
4. Add related kits if needed

### When a team changes ownership

1. Update employee team assignment
2. Verify project team assignments still reflect intended visibility
3. Verify manager assignments if supervisory scope also changed

## 12. Related Files

Key implementation files for the current admin model:

- [client/src/pages/AdminPage.jsx](/C:/Users/testpc/Desktop/office/client/src/pages/AdminPage.jsx)
- [server/src/routes/admin.routes.js](/C:/Users/testpc/Desktop/office/server/src/routes/admin.routes.js)
- [server/src/services/admin.service.js](/C:/Users/testpc/Desktop/office/server/src/services/admin.service.js)
- [server/src/repositories/employee.repository.js](/C:/Users/testpc/Desktop/office/server/src/repositories/employee.repository.js)
- [server/src/repositories/project.repository.js](/C:/Users/testpc/Desktop/office/server/src/repositories/project.repository.js)
- [server/src/repositories/team.repository.js](/C:/Users/testpc/Desktop/office/server/src/repositories/team.repository.js)

## 13. Summary

The current system already supports:

- team-based visibility
- many-to-many manager assignment
- admin password reset and first-login password change

The planned next major infrastructure feature is:

- controlled dual-database operation between MySQL and PostgreSQL

That part is still in design and should remain documented as planned work until implemented.

Detailed design reference:

- [docs/database-dual-runtime-design.md](/C:/Users/testpc/Desktop/office/docs/database-dual-runtime-design.md)
