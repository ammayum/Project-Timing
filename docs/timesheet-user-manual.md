# Timesheet User Manual

## Purpose

This guide explains how to use the timesheet screen for daily time entry.

It is written for normal users, managers, and admins who enter time in the application.

## 1. Opening the Timesheet

After login:

- non-admin users open on the `Timesheet` tab by default
- admin users can open the `Timesheet` tab from the top menu

The timesheet screen lets you:

- add work rows
- select a date
- upload a CSV for preview
- submit daily entries
- load entries already saved for that date

## 2. What You Can Enter

Each row includes:

- `Activity`
- `Project`
- `Order num`
- `Kits`
- `O/T`
- `From`
- `To`

## 3. Choosing a Date

Use the `Entry Date` field at the top of the page.

When you change the date:

- the grid resets to a new blank row for that day

If you want to reuse saved entries for that date, use `Load Saved`.

## 4. Adding Rows

Use the `Add Row` button at the bottom of the table to add more entries for the selected day.

Use the delete button on a row to remove it.

## 5. Activity Rules

Choose an activity from the dropdown.

Current activity types usually include:

- `Project`
- `Admin`
- `Education`
- `Meeting`

### Important

If activity is `Project`:

- you must choose a project

If activity is not `Project`:

- project is not required

## 6. Project Visibility

You will not see every project in the system.

You only see projects that are available to you through:

- your assigned team
- or your direct manager assignment

If you cannot find a project you expect to use:

- contact your admin
- ask them to check your team assignment and the project assignment

## 7. Entering Time

Fill in:

- `From`
- `To`

Example:

```text
From: 08:00
To:   12:00
```

The system calculates hours automatically.

### Important

- overlapping rows are not allowed
- invalid time ranges are not allowed

If a row is highlighted as invalid, review the times and project selection.

## 8. Overtime

Use the `O/T` checkbox when overtime applies.

If your total daily hours go above `7.5`, the page may show a warning asking you to enable overtime where needed.

## 9. Entering Kits

The `Kits` field accepts kit identifiers such as:

- serial numbers
- part codes

Enter them as a space-separated list.

Example:

```text
SR123 PC456 SN789
```

Do not separate kits with commas or `|` when using CSV upload.

## 10. Resolving Kits

Managers and admins may see a `Resolve` button beside the kits field.

This helps verify that the entered kit identifiers exist in the system.

Normal users may not see this button.

## 11. Load Saved

Use `Load Saved` to reload entries already stored for the selected date.

This is useful if:

- you want to continue work later
- you want to review what you already submitted

## 12. Submit

Use `Submit` to save your entries.

On success:

- your entries are stored in the system
- you will see a success message

If the system also tries to sync data elsewhere, the app will report the save result separately from sync status.

## 13. Uploading CSV

Use `Upload CSV` if you want to paste several entries at once.

The system first validates the CSV and shows a preview in the grid before final save.

### Required CSV columns

Your CSV must include:

- `date`
- `activity`
- `project`
- `from_time`
- `to_time`
- `overtime`
- `kits`

Optional:

- `order_num`

### Example CSV

```csv
date,activity,project,from_time,to_time,overtime,kits,order_num
2026-07-20,Project,JA001,08:00,12:00,false,SR123 PC456,ORD-1001
2026-07-20,Meeting,,13:00,15:00,false,,TEAM-MTG
```

### Important CSV rule for kits

The `kits` column must use spaces only between kit values.

Correct:

```text
SR123 PC456 SN789
```

Wrong:

```text
SR123,PC456
SR123|PC456
```

## 14. What Happens After CSV Validation

When CSV validation succeeds:

- rows are loaded into the timesheet grid
- you can still review and edit them
- nothing is saved until you press `Submit`

## 15. Common Problems

### “Project is required”

Cause:

- activity is `Project` but no project is selected

### “Invalid project code”

Cause:

- project code does not exist, or
- that project is not visible to your account

### Overlap warning

Cause:

- two rows use overlapping time ranges

### CSV rejected for kits format

Cause:

- the `kits` column used commas or pipe characters instead of spaces

### Project missing from dropdown

Cause:

- the project is not assigned to your team
- or you are not assigned as a manager on that project

## 16. Best Practice

For the cleanest daily entry:

1. choose the correct date first
2. enter one row per activity block
3. use exact project codes from the dropdown
4. enter kits as space-separated values
5. check total hours before submit
6. use `Load Saved` if you need to continue later

## 17. Need Help?

If something does not appear correctly, contact your admin and provide:

- the date you are entering
- the project code you expected
- whether you used manual entry or CSV
- the error message shown on screen
