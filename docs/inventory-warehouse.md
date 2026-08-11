# Inventory & Warehouse Module

## Scope

This module extends Project Timing with Stores-controlled inventory management.

It manages:

- serialized project assets
- non-serialized quantity stock
- warehouse/store/aisle/shelf/bin locations
- project allocation
- project part-code generation
- project reassignment and historical part codes
- reservations and picking
- Stores to Engineering custody handover
- Engineering to Stores return
- packing, dispatch and courier tracking
- append-only movement and audit history

It intentionally does **not** manage:

- engineer-level staging
- configuration jobs
- firmware
- QA workflows
- procurement
- purchase orders
- supplier invoicing

Engineering is represented only as a team-level stock custody destination/source.

## Serialized identity

A physical device is permanently identified by its serial number.

Its current project-linked part code uses:

```text
XXXYYY-0000
```

- `XXX`: exactly three characters from the current project's `Suffix`
- `YYY`: exactly three characters from the controlled kit type
- `0000`: concurrency-safe sequence for that project suffix and kit type

Example:

```text
WALRTR-0001
```

If the same serial is reassigned to an MOJ project:

```text
WALRTR-0001 -> MOJRTR-0027
```

The serial never changes and the previous code remains searchable in `inventory_asset_part_code_history`.

## Team access

The module uses the existing Employees and Teams model.

### Stores

A user whose team name contains `Store` or `Warehouse` can:

- register serialized assets
- maintain part/location/courier masters
- adjust quantity stock
- reserve and pick stock
- move stock
- create Stores -> Engineering handovers
- accept Engineering returns
- pack and dispatch shipments
- record tracking events

Administrators have Stores permissions.

### Engineering

A user whose team name contains `Engineer` can:

- view inventory
- view stock held by Engineering
- receive Stores -> Engineering custody handovers
- create Engineering -> Stores returns

No engineer-level configuration or staging records are created.

### Managers

Existing `manager` users receive inventory visibility but do not automatically receive Stores write authority unless they belong to a Stores/Warehouse team.

## Authentication policy

Local username/password authentication remains compatible with the existing bcrypt hashes.

Default policy:

```text
PASSWORD_MIN_LENGTH=12
PASSWORD_EXPIRY_DAYS=90
PASSWORD_HISTORY_COUNT=12
PASSWORD_MIN_AGE_DAYS=1
PASSWORD_MAX_FAILED_LOGINS=5
PASSWORD_LOCKOUT_MINUTES=15
```

Existing user passwords are not invalidated during deployment. The first successful login after the security schema is installed starts the managed expiration period for accounts that do not yet have password dates.

Password expiration is checked both during login and on authenticated requests.

## Database initialization

Run:

```bash
npm run migrate:mysql --workspace server
```

The migration command now initializes:

- base Project Timing MySQL schema
- employee authentication extensions
- password history/security fields
- sessions
- Inventory/Warehouse schema

The server also verifies/creates the Inventory schema during startup.

Inventory writes require MySQL to be the active write database.

## Seed data

The inventory schema creates the following teams when missing:

- Stores
- Engineering

It seeds controlled kit types:

- `RTR` Router
- `SWI` Network Switch
- `FIR` Firewall
- `APL` Wireless Access Point
- `SRV` Server
- `UPS` UPS
- `PDU` Power Distribution Unit
- `MOD` Modem
- `ANT` Antenna
- `ACC` Accessory
- `CAB` Cable
- `PSU` Power Supply

It also seeds a Sheffield warehouse and initial operational locations including storage, Engineering custody, returns, quarantine, packing and dispatch.

## Legacy kit migration

Existing `kits` records are not deleted.

Before migration:

1. Ensure every project that owns serialized kits has a valid three-character `Suffix`.
2. Decide the Stores location where migrated stock should initially appear.
3. Back up the database.

Call:

```http
POST /api/v1/inventory/legacy/migrate
Authorization: Bearer <session>
Content-Type: application/json

{
  "defaultLocationId": 1
}
```

The migration:

- skips blank serial numbers
- is idempotent by serial number
- resolves the existing project
- maps device type to a controlled kit type
- creates/reuses an Inventory Part
- generates a new `XXXYYY-0000` current part code
- preserves the old legacy part code in history
- creates an initial inventory movement and audit record
- updates the existing `kits` row rather than replacing its ID

Keeping the legacy `kits.id` preserves existing `time_entry_kits` foreign-key relationships.

The response contains imported, skipped and failed counts plus per-record errors.

## API root

```text
/api/v1/inventory
```

### Read APIs

```text
GET /meta
GET /dashboard
GET /search?q=...
GET /assets
GET /assets/:id
GET /movements
GET /handovers
GET /shipments
GET /audit
```

### Stores master data

```text
POST /kit-types
POST /user-groups
POST /parts
POST /warehouses
POST /locations
POST /couriers
```

### Serialized assets

```text
POST /assets
POST /assets/:id/reassign
POST /movements
```

Part codes are generated on the server. Clients never supply the current part code when registering an asset.

### Quantity stock

```text
POST /stock/adjust
```

Balances cannot be edited directly. Quantity changes create movement and audit records and negative available stock is rejected.

### Reservations / picking

```text
POST /reservations
POST /reservations/:id/pick
```

Serialized reservations claim exact assets. Quantity reservations move quantity from available to reserved.

### Team custody

```text
POST /handovers
POST /handovers/:id/receive
```

Directions:

```text
STORES_TO_ENGINEERING
ENGINEERING_TO_STORES
```

The receiving side must acknowledge the handover before custody changes.

### Shipping

```text
POST /shipments
POST /shipments/:id/dispatch
POST /shipments/:id/tracking-events
```

Serialized assets cannot be placed into two active shipments.

A `DELIVERED` tracking event moves asset custody to `PROJECT_SITE` and status to `DELIVERED`.

## Frontend

The main React navigation now exposes **Inventory** to:

- administrators
- managers
- Stores/Warehouse team users
- Engineering team users

The workspace includes:

- operational dashboard
- global scanner/search bar
- serialized asset list
- Asset 360 view
- serialized stock registration
- quantity adjustment
- Stores movement
- team custody handovers
- shipping and tracking
- movement history
- audit history
- kit type, part, warehouse, location and courier setup

## Scanner use

Standard keyboard-wedge USB/Bluetooth barcode scanners work with the serial/part-code inputs without a vendor SDK.

Recommended serialized label:

```text
PROJECT: WAL
PART: WALRTR-0047
SERIAL: FCZ2918231
```

## Deployment checklist

1. Back up MySQL.
2. Confirm project suffix data.
3. Set password policy environment values.
4. Run `npm run migrate:mysql --workspace server`.
5. Assign relevant employees to Stores or Engineering teams.
6. Start the server.
7. Confirm `/api/ready` is healthy.
8. Sign in as a Stores user and open Inventory.
9. Validate kit types and locations.
10. Run the legacy kit migration only after reviewing project suffixes and taking a backup.
11. Reconcile migrated serial counts with the old `kits` table.
12. Test one complete flow: register/reserve/pick -> Engineering handover -> return -> pack -> dispatch -> delivery.

## Operational invariants

The backend enforces these principles:

- serial number is permanent
- current part code is unique
- part code format is `XXXYYY-0000`
- project reassignment generates a new part code
- previous part codes remain searchable
- Stores owns physical inventory operations
- Engineering is team custody only
- stock cannot become negative
- serialized assets cannot be double-reserved or double-shipped
- handovers require recipient acknowledgement
- stock-changing actions create movement records
- privileged inventory actions create audit records
