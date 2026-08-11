# Inventory & Warehouse Module

## Scope

This module extends Project Timing with Stores-controlled inventory management and controlled Engineering custody locations.

It manages:

- serialized project assets
- non-serialized quantity stock
- warehouse/store/aisle/shelf/bin locations
- Engineer-assigned inventory locations
- project allocation
- project part-code generation
- project reassignment and historical part codes
- reservations and picking
- Stores to Engineering custody handover
- direct Stores moves into Engineering custody locations
- Engineering moves into the Engineer's own assigned location
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

Engineering remains stock-custody only. Individual Engineers may have assigned inventory locations, but the system does not track their configuration/staging process.

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
- create and assign Engineering custody locations
- adjust quantity stock
- reserve and pick stock
- move stock between Stores locations
- move Stores-custody kits directly into Engineering custody locations
- create Stores -> Engineering handovers
- accept Engineering returns
- pack and dispatch shipments
- record tracking events

A direct Stores move into an `ENGINEERING_CUSTODY` location changes the asset to:

```text
current_custody = ENGINEERING
stock_status = WITH_ENGINEERING
```

Administrators have Stores permissions.

### Engineering

A user whose team name contains `Engineer` can:

- view inventory
- view stock held by Engineering
- receive Stores -> Engineering custody handovers
- move an Engineering-custody kit into an `ENGINEERING_CUSTODY` location assigned to that same employee
- create Engineering -> Stores returns

Engineering users cannot move stock into another Engineer's assigned location and cannot directly move stock back into Stores locations; returns continue through the formal Engineering -> Stores return workflow.

No engineer-level configuration or staging records are created.

### Managers

Existing `manager` users receive inventory visibility but do not automatically receive Stores write authority unless they belong to a Stores/Warehouse team.

## Engineer-assigned locations

`inventory_locations` includes an optional `assigned_employee_id`.

Personal Engineer locations use:

```text
location_type = ENGINEERING_CUSTODY
assigned_employee_id = <employee id>
```

Stores can create and assign these locations from the **Kit Locations** workspace.

Example:

```text
SHEF-ENG-AMMAYU
Type: ENGINEERING_CUSTODY
Assigned employee: Ammayu
```

A Stores user can move a kit into this location. Once the kit is in Engineering custody, Ammayu can move the kit into locations assigned to Ammayu, but not locations assigned to another Engineer.

Every move creates both a movement ledger entry and an inventory audit event.

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
- Engineer-assigned inventory location schema

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

The Engineer-location schema ensures the default Sheffield warehouse exists. Operational locations can then be created or assigned from the Inventory/Kit Locations workspaces.

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
GET /location-moves/meta
```

### Stores master data

```text
POST /kit-types
POST /user-groups
POST /parts
POST /warehouses
POST /locations
POST /couriers
POST /engineering-locations
POST /engineering-locations/:id/assign
```

### Serialized assets

```text
POST /assets
POST /assets/:id/reassign
POST /movements
POST /location-moves
```

`POST /location-moves` is scanner-friendly and accepts either serial number or current part code.

For Stores users it supports normal Stores movements and direct movement to Engineering custody locations.

For Engineering users the destination must be an `ENGINEERING_CUSTODY` location assigned to the authenticated employee.

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

Formal handovers remain available where recipient acknowledgement is required. Stores may alternatively make a direct audited move into an Engineering custody location.

### Shipping

```text
POST /shipments
POST /shipments/:id/dispatch
POST /shipments/:id/tracking-events
```

Serialized assets cannot be placed into two active shipments.

A `DELIVERED` tracking event moves asset custody to `PROJECT_SITE` and status to `DELIVERED`.

## Frontend

The main React navigation exposes **Inventory** to inventory viewers and a separate **Kit Locations** workspace to:

- administrators
- Stores/Warehouse team users
- Engineering team users

The Inventory workspace includes:

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

The **Kit Locations** workspace includes:

- scanner-first serial/part-code movement
- Stores direct movement to Engineering locations
- Engineer movement to personal assigned locations
- personal Engineering location creation by Stores
- assignment/reassignment of Engineering locations by Stores

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
9. Validate kit types and warehouse locations.
10. In **Kit Locations**, create/assign Engineering custody locations to Engineers.
11. Run the legacy kit migration only after reviewing project suffixes and taking a backup.
12. Reconcile migrated serial counts with the old `kits` table.
13. Test Stores moving one kit directly to an Engineer location.
14. Sign in as that Engineer and move the kit into another location assigned to the same Engineer.
15. Test Engineering -> Stores return, packing, dispatch and delivery.

## Operational invariants

The backend enforces these principles:

- serial number is permanent
- current part code is unique
- part code format is `XXXYYY-0000`
- project reassignment generates a new part code
- previous part codes remain searchable
- Stores owns warehouse inventory administration
- Stores may move Stores-custody stock into Engineering custody locations
- Engineering may move Engineering-custody kits only into locations assigned to the authenticated Engineer
- Engineering does not gain Stores stock-adjustment, reservation, picking or shipping permissions
- Engineering-to-Stores movement still uses the formal return workflow
- stock cannot become negative
- serialized assets cannot be double-reserved or double-shipped
- handovers require recipient acknowledgement when the handover workflow is used
- stock-changing actions create movement records
- privileged inventory actions create audit records
