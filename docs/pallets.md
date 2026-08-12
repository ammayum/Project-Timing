# Pallet Handling Units

## Purpose

Pallets are first-class physical handling units inside the Inventory & Warehouse module. A pallet groups serialized project kits so Stores and Engineering can scan and move the whole physical unit while every contained kit keeps its own serial number, project part code and movement history.

## Pallet part-code format

Pallets use the same project-linked identity principle as serialized kits:

```text
XXXPLT-0000
```

- `XXX` = the pallet project's exactly three-character project suffix
- `PLT` = fixed pallet handling-unit type
- `0000` = concurrency-safe sequential number for that project suffix

Examples:

```text
WALPLT-0001
WALPLT-0002
MOJPLT-0001
```

A pallet code is globally unique.

## Relationship to kit part codes

A pallet code does not replace kit identity.

Example pallet:

```text
WALPLT-0001
```

may contain:

```text
WALRTR-0047   Serial FCZ2918231
WALSWI-0018   Serial FDO9281112
WALAPL-0084   Serial CNB8819201
```

The serial number stays permanent. The individual kit part code continues to identify the device within its project. Pallet membership is an additional handling relationship only.

## Project rule

A pallet belongs to exactly one project. All serialized kits placed on the pallet must belong to the same project as the pallet.

The pallet code is generated from that project's suffix. Users never manually choose the sequence.

## Location and custody rule

A pallet has one current location and one current custody state. Every contained kit must be physically synchronized with the pallet before the pallet can move.

When the pallet moves, all contained serialized kits move inside the same database transaction.

### Stores to Stores

```text
Stores location -> Stores location
```

Custody remains `STORES`. Existing kit statuses are retained.

### Stores to Engineering

```text
Stores location -> ENGINEERING_CUSTODY location
```

The pallet and every contained kit become:

```text
Custody: ENGINEERING
Kit status: WITH_ENGINEERING
```

### Engineering movement

Engineering users can move an Engineering-custody pallet only to an `ENGINEERING_CUSTODY` location assigned to their own employee account.

They cannot move a pallet to another Engineer's assigned location.

### Engineering to Stores

A Stores user can receive/move the physical pallet back into a Stores location. The pallet custody becomes `STORES` and the contained kits are marked `RETURNED`.

## Pallet contents

Only Stores can add or remove kits from a pallet.

A kit can belong to only one current pallet.

To add a kit:

- pallet must be `OPEN`
- kit must belong to the pallet project
- kit must be in the same physical location as the pallet
- kit custody must match pallet custody
- kit must not already belong to another pallet
- kit must not be dispatched, in transit, delivered, lost or retired

Every add/remove action is written to `inventory_pallet_membership_history` and the inventory audit log.

## Open and sealed pallets

Pallet statuses:

```text
OPEN
SEALED
CLOSED
```

`OPEN` allows Stores to change contents.

`SEALED` locks the contents but still allows the pallet to be physically moved.

`CLOSED` prevents further movement.

## Pallet movement traceability

A pallet movement creates:

1. a pallet movement record in `inventory_pallet_movements`
2. one standard Inventory movement containing every serialized asset on the pallet
3. an audit event for the pallet
4. updates to each contained asset's location, custody and applicable stock status

This means Asset 360 movement history continues to work even when the device was moved as part of a pallet.

## Individual kit movement protection

The Kit Locations workflow rejects an individual location move if the kit is currently on a pallet.

The operator must either:

- move the whole pallet, or
- have Stores open the pallet and remove the kit first

This prevents the physical pallet location from diverging from the location recorded on its contents.

## API

Base path:

```text
/api/v1/inventory
```

Endpoints:

```text
GET  /pallets/meta
GET  /pallets
GET  /pallets/:id
POST /pallets
POST /pallets/:id/items
POST /pallets/:id/items/remove
POST /pallets/:id/status
POST /pallets/:id/move
```

Pallet creation and contents management require Stores access. Pallet movement is available to Stores and Engineering under the custody/location rules above.

## Frontend

The main application navigation includes **Pallets** for Inventory-authorized users.

The Pallets workspace includes:

- pallet KPI cards
- pallet-code/project/location search
- Stores pallet creation
- automatic `XXXPLT-0000` generation
- optional initial kit scanning
- pallet list and status
- pallet label preview/print
- detailed serialized contents
- scan-to-add kits
- scan-to-remove kits
- OPEN / SEALED content control
- whole-pallet movement
- Stores to Engineering movement
- Engineer self-location movement
- pallet movement history

## Label example

```text
Inventory & Warehouse
Pallet Handling Unit

WALPLT-0001

Project:  JA420294
Location: SHEF-01-A03
Custody:  STORES
Contents: 24 serialized kits
```

The printed pallet label intentionally shows the pallet code. Individual kit labels remain unchanged.

## Database tables

```text
inventory_pallet_sequences
inventory_pallets
inventory_pallet_assets
inventory_pallet_membership_history
inventory_pallet_movements
```

The pallet schema is initialized by both normal server startup and:

```bash
npm run migrate:mysql --workspace server
```
