# Pallet Handling Units

## Purpose

Pallets are first-class physical handling units inside the Inventory & Warehouse module. A pallet groups serialized project kits so Stores and Engineering can scan and move the whole physical unit while every contained kit keeps its own serial number, project part code and movement history.

Pallet membership is deliberately flexible: a kit can still be moved separately. When that happens, the movement transaction deducts only that kit from the pallet membership so the pallet's live kit list and count remain accurate. The pallet itself is never disbanded by a single-kit movement.

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

A pallet has one current location and one current custody state. Kits that remain members of that pallet move with it in the same database transaction.

A kit may also be moved independently. An independent kit move deducts that one kit from pallet membership first, records the removal in membership history, and then completes the kit move. The pallet code, project, status, location and custody are not changed by that individual kit movement.

### Stores to Stores

```text
Stores location -> Stores location
```

Custody remains `STORES`. Existing kit statuses are retained.

### Stores to Engineering

```text
Stores location -> ENGINEERING_CUSTODY location
```

The pallet and every kit still on its live membership list become:

```text
Custody: ENGINEERING
Kit status: WITH_ENGINEERING
```

### Engineering movement

Engineering users can move an Engineering-custody pallet only to an `ENGINEERING_CUSTODY` location assigned to their own employee account.

They cannot move a pallet to another Engineer's assigned location.

Engineering users may also move an individual Engineering-custody kit to a location assigned to themselves. If that kit was on a pallet, only that kit is deducted from the pallet membership first.

### Engineering to Stores

A Stores user can receive/move the physical pallet back into a Stores location. The pallet custody becomes `STORES` and the contained kits are marked `RETURNED`.

## Pallet contents are live and auto-calculated

The pallet does not store a manually maintained kit count. The displayed list and count are calculated from current rows in `inventory_pallet_assets`.

The pallet detail API also returns an automatically calculated summary containing:

- total current kit count
- current kit list
- kit-type counts

Whenever a kit is added, removed, list-edited, or independently moved away, pallet membership changes and the next pallet read shows the recalculated result.

A pallet remains a valid pallet even when its current kit count reaches zero. It is not automatically deleted or closed. Stores may later add kits back to an OPEN pallet or explicitly change the pallet status according to the normal pallet workflow.

## Editing a pallet kit list

Only Stores can manually edit pallet contents.

The Pallets workspace supports three editing methods:

1. **Edit complete pallet kit list** — the authoritative batch editor. The operator can paste/scan the final desired list and save it. The backend calculates which kits were added and removed.
2. **Quick scan: add kits** — adds one or many scanned serial/part codes.
3. **Quick scan: remove kits** — removes one or many scanned serial/part codes.

The complete-list editor may be saved as an empty list to clear an OPEN pallet without deleting the pallet itself.

A kit can belong to only one current pallet.

To add a kit:

- pallet must be `OPEN`
- kit must belong to the pallet project
- kit must be in the same physical location as the pallet
- kit custody must match pallet custody
- kit must not already belong to another pallet
- kit must not be dispatched, in transit, delivered, lost or retired

Every add/remove/list-edit action is written to `inventory_pallet_membership_history` and the inventory audit log.

## Open and sealed pallets

Pallet statuses:

```text
OPEN
SEALED
CLOSED
```

`OPEN` allows Stores to manually change contents.

`SEALED` blocks manual add/remove/list-edit actions but still allows the pallet to be physically moved. An individual kit remains movable when operationally required; such a move deducts only that kit from the sealed pallet so inventory location and pallet membership cannot contradict each other. The pallet remains SEALED with one fewer kit.

`CLOSED` prevents further pallet movement.

## Whole-pallet movement traceability

A pallet movement creates:

1. a pallet movement record in `inventory_pallet_movements`
2. one standard Inventory movement containing every serialized asset currently on the pallet
3. an audit event for the pallet
4. updates to each contained asset's location, custody and applicable stock status

This means Asset 360 movement history continues to work even when the device was moved as part of a pallet.

## Individual kit movement

Kits never lose their independent movement capability merely because they are on a pallet.

When a kit is moved separately from **Inventory** or **Kit Locations**:

1. the system checks normal Stores/Engineering movement permissions
2. if the kit belongs to a pallet, only that kit's membership row is removed inside the same database transaction
3. a `REMOVE` entry is written to `inventory_pallet_membership_history`
4. the pallet version/update timestamp is advanced so the live list refreshes
5. the pallet code, project, status, location and custody remain unchanged
6. the individual kit movement is completed
7. the pallet's next live read automatically shows one fewer kit

Example:

```text
Before
WALPLT-0001 = 24 kits
Pallet status = OPEN
Pallet location = SHEF-01-A03

Move WALRTR-0047 separately

After
WALPLT-0001 = 23 kits
Pallet status = OPEN
Pallet location = SHEF-01-A03
WALRTR-0047 = destination selected by the operator
```

If the pallet had only one kit, moving that kit separately results in:

```text
WALPLT-0001 = 0 kits
```

The pallet still exists with the same pallet code and status. It is not disbanded automatically.

Moving a whole pallet affects only the kits that are members at the time of that pallet move.

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
POST /pallets/:id/items/sync
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
- live auto-calculated pallet list and kit count
- kit-type count summary
- complete pallet-list editor
- scan-to-add kits
- scan-to-remove kits
- pallet label preview/print
- OPEN / SEALED content control
- independent kit movement that deducts only the moved kit from pallet membership
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

The printed pallet label intentionally shows the pallet code and live kit count. Individual kit labels remain unchanged.

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
