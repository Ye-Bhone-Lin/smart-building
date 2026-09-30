# Testing Results — Smart Building Monitoring (CET333)

Tested on the live Firebase project `schoolmanagementsystem-fc272` via
`http://localhost:3000`, signed in as **Daw Htun (CEO / Super Admin)** unless a
row says otherwise. Screenshots are in `docs/testing/shots/`.

**Method note.** The capture browser runs off-screen, which freezes the CSS
animation clock. Entry animations were disabled before each capture, so
screenshots show final state without motion. Nothing else was altered.

## Feature inventory

| Area | Features under test |
| --- | --- |
| Auth | Sign in, wrong password, forgot password, first sign-in, session expired, sign out, route guard, suspension |
| Dashboard | Building selector, KPI tiles, power chart, estate table, requests needing a decision, live alerts, log rail |
| Equipment | Register/Board views, search, building + type filters, decommissioned toggle, type registry (add/rename/archive), new unit, detail drawer, 6 unit actions, photo upload |
| Sensors | Monitoring/Thresholds tabs, climate grid, donut, attention queue, device filters, reading charts, manual dial, new sensor, sensor type registry, threshold exceptions |
| Requests | Kanban/Table, new request, five-step workflow, decline with reason, withdraw, verify, filters, sort |
| Records | Important/All switch, range + building + type filters, reason display, CSV export |
| Log Book | Live feed, Actions only toggle, source + date-time filters, pause |
| Reports | Library, generate with period, open report, PDF, CSV, filters |
| Administration | Buildings CRUD + photo + rooms, User Accounts CRUD, role edit, suspend |
| Settings / More | Account, appearance (light/dark/system), password change, phone-only nav |
| Errors | 404 inside shell, 403 refusal, crash boundary |
| Responsive | Desktop, tablet rail, phone toolbars and bottom sheet |

## Results

| No. | Test Description | Expected Result | Performed as expected? | If no, what happened? [Fixed/Unfixed] |
| --- | --- | --- | --- | --- |
| | **General** | | | |
| 1 | Load `/dashboard` as CEO | Shell, sidebar, KPI tiles and all six panels render | Yes | |
| 2 | Change building selector to Building 209 | Rooms, equipment counts and load recalculate for 209 only | Yes | |
| 3 | Click "Open register" on the equipment card | Navigates to `/equipment` | Yes | |
| | **/equipment** | | | |
| 4 | Toggle Register / Condition board | View switches, same 28 units | Yes | |
| 5 | Search "projector" | Count drops 28 → 6; non-matching rows dim | Yes | Rows dim rather than being removed — by design, keeps position |
| 6 | Filter by Building 216 | Count 12, only 216 units listed | Yes | |
| 7 | Filter by type "Air handling unit" | Count 2 | Yes | |
| 8 | Toggle "Show decommissioned" | Count 28 → 30, two DECOMMISSIONED rows appear, label flips to "Hide" | Yes | |
| 9 | Open "Manage types" | 720px sheet lists 16 types with id, unit count, state, Rename/Archive | Yes | |
| 10 | Click "+ New unit" | 392px drawer opens with tag, type, building, room, installed, interval | Yes | |
| 11 | Submit new unit with empty asset tag | Inline error, form not submitted | Yes | |
| 12 | Create unit `EQ-209-TEST1` | Toast, count 30 → 31, row appears HEALTHY, next service = install + 180 days | Yes | |
| 13 | **Database:** unit written to Firestore | `equipmentUnits/EQ-209-TEST1` holds buildingId, condition, installedAt, nextServiceDue, roomId, serviceIntervalDays, tag, typeId; document id is the asset tag | Yes | |
