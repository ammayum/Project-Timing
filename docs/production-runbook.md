# Production Runbook

## Deployment

The production topology is:

```text
Browser --HTTPS--> Nginx --HTTP localhost--> Node API --MySQL--> MySQL server
                                      \------ optional PostgreSQL inspection/replication
```

Use a dedicated Linux service account and keep the environment file outside the repository at `/etc/project-billing-system/project-billing-system.env`.

```bash
sudo install -d -o project-billing -g project-billing /opt/project-billing-system
sudo install -d -o root -g project-billing -m 0750 /etc/project-billing-system
cp .env.example /etc/project-billing-system/project-billing-system.env
chmod 0640 /etc/project-billing-system/project-billing-system.env
npm ci
npm run build
npm run migrate:mysql --workspace server
sudo systemctl enable --now project-billing-system
```

Set `FRONTEND_ORIGINS` to the exact HTTPS origin users will visit. Keep `VITE_API_BASE_URL=/api` so browser requests remain same-origin.

## Readiness and health

- `GET /api/health` is a process liveness check.
- `GET /api/ready` verifies production mode, MySQL connectivity, MySQL primary/write status, and required tables.
- Nginx or the service monitor must remove the site from service when `/api/ready` returns `503`.

The required MySQL tables include employees, teams, projects, project assignment tables, time-entry tables, kits, stock reports, and auth sessions.

## Database operations

MySQL is the production write path. Do not switch the runtime to PostgreSQL in pilot production. PostgreSQL may be enabled only for controlled inspection or replication validation.

Before every schema change:

1. Take a timestamped MySQL backup.
2. Test the migration against a disposable database.
3. Run `npm run migrate:mysql --workspace server` during a maintenance window.
4. Check `/api/ready` and perform the smoke test.

Example backup and restore commands:

```bash
mysqldump --single-transaction --routines --triggers \
  -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p \
  "$MYSQL_DATABASE" > "backup-$(date +%Y%m%d-%H%M%S).sql"

mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p \
  "$MYSQL_DATABASE" < backup-YYYYMMDD-HHMMSS.sql
```

Rollback application code by deploying the previous tested release. Roll back database changes only with a tested reverse migration or a verified backup restore.

## Security and privacy

- Never commit `.env`, production credentials, generated passwords, or smoke-test credentials.
- Use HTTPS at Nginx and keep the API bound behind the reverse proxy in production.
- Keep development auth bypass and memory mode disabled.
- Session tokens are stored server-side as hashes and expire after inactivity.
- Logs exclude request bodies and passwords. Retain logs only for the approved operational period and restrict access to operators who need them.
- Use generic login and server-error responses so database details and stack traces are not disclosed.

## Incident response

For suspected credential exposure, rotate `JWT_SECRET`, database credentials, and affected user passwords; revoke active sessions by clearing or rotating the session table; then restart the service and verify readiness. Preserve relevant security logs according to the approved retention policy.

## Release verification

```bash
npm run lint
npm run build
curl -fsS https://billing.example.com/api/health
curl -fsS https://billing.example.com/api/ready
```

Run the browser smoke test with credentials supplied only through the process environment:

```bash
SMOKE_ADMIN_USERNAME='...' \
SMOKE_ADMIN_PASSWORD='...' \
SMOKE_EMPLOYEE_USERNAME='...' \
SMOKE_EMPLOYEE_PASSWORD='...' \
node scripts/smoke-e2e.mjs
```
