# Timesheet Input Technical Guide

## Purpose

This document explains the current timesheet input system from a technical and administrative perspective.

It covers:

- frontend data entry behavior
- backend validation rules
- project visibility restrictions
- CSV upload rules
- database write flow

This document reflects the current implemented behavior as of July 20, 2026.

## 1. Feature Summary

The timesheet feature allows authenticated users to:

- create daily time-entry rows
- select an activity type
- select an allowed project when activity is `Project`
- enter order number
- enter kit identifiers
- mark overtime
- submit entries for a single day
- upload time entries using CSV for preview and validation before save
- reload already saved entries for a selected date

## 2. Main Frontend Components

### Time entry page

Primary screen:

- [client/src/pages/TimeEntryPage.jsx](/C:/Users/testpc/Desktop/office/client/src/pages/TimeEntryPage.jsx)

Responsibilities:

- load timesheet metadata from `/api/time-entries/meta`
- show date picker
- submit rows to `/api/time-entries`
- load existing entries from `/api/time-entries?date=...`
- launch CSV upload modal

### Time grid

Main row-entry component:

- [client/src/components/TimeEntryGrid.jsx](/C:/Users/testpc/Desktop/office/client/src/components/TimeEntryGrid.jsx)

Responsibilities:

- render editable row grid
- enforce project selection in UI when activity is `Project`
- display overlap and invalid-hour visual feedback
- allow manager/admin kit resolution action

### CSV modal

CSV upload UI:

- [client/src/components/CsvUploadModal.jsx](/C:/Users/testpc/Desktop/office/client/src/components/CsvUploadModal.jsx)

Responsibilities:

- collect pasted CSV content
- submit CSV to `/api/time-entries/upload`
- display current CSV format guidance

## 3. API Endpoints

### `GET /api/time-entries/meta`

Returns:

- visible projects for current user
- available activity types

Technical source:

- [server/src/routes/time-entry.routes.js](/C:/Users/testpc/Desktop/office/server/src/routes/time-entry.routes.js)

### `GET /api/time-entries?date=YYYY-MM-DD`

Returns:

- existing entries for current employee and selected date

### `POST /api/time-entries`

Accepts:

- `sync`
- `entries[]`

Writes validated entries into the database.

### `POST /api/time-entries/upload`

Accepts:

- raw CSV content

Returns:

- validated preview payload
- total calculated hours

This endpoint does not save rows. It validates and previews only.

## 4. Activity Rules

Current activity list comes from the database and is rendered in the UI.

Typical current values:

- `Project`
- `Admin`
- `Education`
- `Meeting`

### Project activity rule

If activity is `Project`:

- `project` is required

If activity is not `Project`:

- `project` is cleared in the UI
- backend allows null project

## 5. Project Visibility Rules

Projects shown in timesheet input are not global for normal users.

Visible projects come from:

- [server/src/repositories/project.repository.js](/C:/Users/testpc/Desktop/office/server/src/repositories/project.repository.js)

### Current visibility behavior

Admin:

- sees all active projects

Non-admin user:

- sees projects assigned to the user’s team
- also sees projects directly assigned to that user as a manager

This rule is enforced in:

- metadata loading
- CSV preview validation
- final save validation

This means hidden projects cannot be submitted just by manually editing request payloads.

## 6. Frontend Row Model

Each editable row currently contains:

- `date`
- `activity`
- `project`
- `order_num`
- `from_time`
- `to_time`
- `overtime`
- `kits`

The `kits` value is handled as a plain text field in the UI and normalized on the backend.

## 7. Validation Rules

Main logic lives in:

- [server/src/services/time-entry.service.js](/C:/Users/testpc/Desktop/office/server/src/services/time-entry.service.js)

### Required rules

- at least one time entry row must exist
- activity is required
- `from_time` is required
- `to_time` is required
- project is required when activity is `Project`

### Time rules

- overlapping rows are rejected
- invalid zero/negative durations are rejected by hour calculation rules
- daily total is validated against the 7.5-hour rule

### Overtime rule

If total daily hours exceed 7.5:

- overtime must be enabled where required by business logic

Frontend also surfaces this as an inline warning.

## 8. Kit Handling Rules

### Manual input

The kits field currently expects identifiers such as:

- serial number
- part code

Example:

```text
SR123 PC456 SN789
```

### Parsing behavior

Backend splits identifiers from text input and CSV input.

For time-entry CSV specifically, the `kits` column is now restricted to:

- space-separated values only

Accepted:

```text
SR123 PC456 SN789
```

Rejected:

```text
SR123,PC456
SR123|PC456
```

### Missing kit behavior

When saving time entries:

- missing kits can be auto-created with placeholder metadata

When previewing CSV only:

- unresolved kits are shown as placeholder preview values
- preview does not persist them

## 9. CSV Upload Specification

Validation logic lives in:

- [server/src/services/csv.service.js](/C:/Users/testpc/Desktop/office/server/src/services/csv.service.js)

### Required columns

Current required columns for time-entry CSV:

- `date`
- `activity`
- `project`
- `from_time`
- `to_time`
- `overtime`
- `kits`

Optional additional supported field:

- `order_num`

### Example CSV

```csv
date,activity,project,from_time,to_time,overtime,kits,order_num
2026-07-20,Project,JA001,08:00,12:00,false,SR123 PC456,ORD-1001
2026-07-20,Meeting,,13:00,15:00,false,,TEAM-MTG
```

### CSV processing flow

1. user pastes CSV into modal
2. frontend posts to `/api/time-entries/upload`
3. backend checks required columns
4. backend validates kits column format
5. backend validates activities, project visibility, hours, overlaps
6. backend returns preview payload
7. frontend maps preview into editable grid

## 10. Load Existing Entries

When a user chooses `Load Saved`:

- frontend requests entries for selected date
- backend returns previously stored rows for that employee/date
- frontend maps returned kits array into space-separated string for the grid

Database access:

- [server/src/repositories/time-entry.repository.js](/C:/Users/testpc/Desktop/office/server/src/repositories/time-entry.repository.js)

## 11. Database Write Flow

### Tables involved

- `time_entries`
- `time_entry_kits`
- `activity_types`
- `projects`
- `kits`

### Save behavior

The service:

1. validates and hydrates rows
2. checks overlap and total-hour rules
3. inserts `time_entries`
4. inserts linking rows into `time_entry_kits`
5. optionally triggers sync behavior

Writes are done transactionally through:

- `withTransaction(...)`

## 12. Sync Behavior

The current save path still includes a sync stage:

- [server/src/services/sync.service.js](/C:/Users/testpc/Desktop/office/server/src/services/sync.service.js)

Operationally:

- save succeeds first
- sync result is returned separately
- sync failure does not necessarily roll back the saved time entry

## 13. Error Sources to Expect

Common timesheet input failures:

- invalid or inaccessible project code
- overlapping time rows
- missing required project for `Project` activity
- invalid kits CSV format
- empty CSV
- missing required CSV columns

## 14. Recommended Operational Checks

If users report missing projects:

1. confirm the employee has a team
2. confirm the project is assigned to that team
3. confirm the project is active
4. confirm the user is not expecting admin/global visibility

If CSV preview fails:

1. check required column names
2. check `kits` column uses spaces only
3. confirm project codes are visible to that user
4. confirm time ranges do not overlap

## 15. Related Files

- [client/src/pages/TimeEntryPage.jsx](/C:/Users/testpc/Desktop/office/client/src/pages/TimeEntryPage.jsx)
- [client/src/components/TimeEntryGrid.jsx](/C:/Users/testpc/Desktop/office/client/src/components/TimeEntryGrid.jsx)
- [client/src/components/CsvUploadModal.jsx](/C:/Users/testpc/Desktop/office/client/src/components/CsvUploadModal.jsx)
- [server/src/routes/time-entry.routes.js](/C:/Users/testpc/Desktop/office/server/src/routes/time-entry.routes.js)
- [server/src/services/time-entry.service.js](/C:/Users/testpc/Desktop/office/server/src/services/time-entry.service.js)
- [server/src/services/csv.service.js](/C:/Users/testpc/Desktop/office/server/src/services/csv.service.js)
- [server/src/repositories/time-entry.repository.js](/C:/Users/testpc/Desktop/office/server/src/repositories/time-entry.repository.js)
- [server/src/repositories/project.repository.js](/C:/Users/testpc/Desktop/office/server/src/repositories/project.repository.js)

## 16. Summary

The current timesheet input system is:

- role-aware
- team-aware
- project-visibility restricted
- validated on both UI and API layers
- CSV-preview capable

The most important current CSV rule is:

- time-entry `kits` values must be space-separated only
