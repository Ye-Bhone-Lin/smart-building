# Application flow and use cases

Companion to [`application-flow.drawio`](./application-flow.drawio) — six
pages: session and navigation, the request lifecycle, **use cases by role**,
the affordance/enforcement layers, a **system flowchart** (a session starting,
the request lifecycle, what happens to any write, and a reading becoming a
status) and the **entity relationships** across the eleven collections.

Every row below is traceable to a predicate in
[`src/lib/permissions.ts`](../src/lib/permissions.ts). Nothing here describes
intent; it describes what the code does.

---

## 1. The cycle

Sign in with an email and password. The profile at `users/{uid}` resolves your
role, and until it does no page renders — being authenticated is not the same
as being usable here. You land on a shell whose sidebar is filtered to your
rank, scoped to one building if you are Office Staff and to the whole estate
otherwise. You act: raise a request, move one along, set a unit's condition,
reset an alarm, edit the estate. **Every action writes a Log Book entry**, and
because all eleven collections are live `onSnapshot` subscriptions, the change
appears on every other page and in every other open tab at once. Sign out and
the data stays; it is Firestore, not session state.

---

## 2. Roles

Three roles, ranked. `roleRank()` returns 1, 2 or 3 and every gate compares
**rank**, never role equality — a new role slots into the ladder without
rewriting a single check.

| Rank | Role | In one sentence |
| :-: | --- | --- |
| 3 | **Office Staff** | Raises requests and follows them, works on equipment, watches everything else — inside one building. |
| 2 | **Admin Manager** | Decides what happens: approves requests, acts on sensors, runs the estate's accounts and device registry. |
| 1 | **CEO / Super Admin** | Everything an Admin Manager does, plus the estate itself — buildings and rooms. |

Rank 1 contains rank 2 contains rank 3, with **one exception**: account
editing. See the matrix.

---

## 3. Capability matrix

✓ allowed · — not allowed · *qualified* where the rule has a condition.

| Capability | Office Staff | Admin Manager | CEO | Gate |
| --- | :-: | :-: | :-: | --- |
| Sign in, change own password | ✓ | ✓ | ✓ | — |
| Edit own name and phone | ✓ | ✓ | ✓ | Settings, not Administration |
| See the dashboard and estate overview | *own building* | ✓ | ✓ | `isBuildingLocked` |
| Change which building is in scope | — | ✓ | ✓ | `isBuildingLocked` |
| **Requests** | | | | |
| Raise a maintenance request | ✓ | ✓ | ✓ | ungated |
| Withdraw a request | *own, before approval* | *own* | *own* | `canWithdrawRequest` |
| Ask for close-out verification | *own, at resolved, once* | *own* | *own* | `canRequestVerification` |
| Approve, advance or step back | — | ✓ | ✓ | `canAdvanceRequest` |
| Decline with a reason | — | ✓ | ✓ | `canAdvanceRequest` |
| **Equipment** | | | | |
| Browse the register and history | ✓ | ✓ | ✓ | ungated |
| Add a unit, edit its details | ✓ | ✓ | ✓ | ungated |
| Set condition, record a service, move it, attach a photo | ✓ | ✓ | ✓ | ungated |
| Decommission or delete a unit | — | ✓ | ✓ | `canDecommissionEquipment` |
| **Sensors** | | | | |
| See every device and its live state | ✓ | ✓ | ✓ | ungated |
| Reset, lock or unlock | — | ✓ | ✓ | `SensorAction.allowedRoles` |
| Register, edit or remove a device | — | ✓ | ✓ | `canActOnSensor` |
| **Ledgers and reports** | | | | |
| Search Historical Records | *own building* | ✓ | ✓ | `isBuildingLocked` |
| Read the Log Book | — | ✓ | ✓ | `canAccessLogBook` |
| Generate and export reports | — | ✓ | ✓ | `canAccessReports` |
| **Administration** | | | | |
| Manage sensor types | — | ✓ | ✓ | `canManageSensorTypes` |
| Manage user accounts | — | *Office Staff rows only* | *anyone but self* | `canEditUser` |
| Manage buildings and rooms | — | — | ✓ | `canManageEstate` |

**The exception to the ladder.** `canEditUser` is the one rule generalisation
cannot express: an Admin Manager may edit Office Staff rows and nothing else —
not a peer, not the CEO — and **nobody may edit their own row**, the CEO
included. Your own name and phone are yours to change in Settings; your role
and your building scope are not.

**Equipment is the one place Office Staff act on assets.** That is deliberate:
they are the people standing next to the projector. Sensors are the opposite —
read-only for staff, every action padlocked.

**A padlock, not a disappearance.** A control a role may not use stays on
screen with the reason in its tooltip, so the boundary is visible rather than
mysterious. The `*_LOCK_REASON` strings in `permissions.ts` are those tooltips.

---

## 4. Request lifecycle

Five steps, approval first:

```
requested → approved → in-progress → resolved → completed
```

Each forward step has a name — Approve, Start work, Mark resolved, Close out —
and each is reversible by one step, with the backward move asking for
confirmation because the request's age never resets. All eight transitions sit
behind the same gate, `canAdvanceRequest`: whoever moves a request along is who
decides it belongs there.

Three things look like transitions and are not:

- **Decline** attaches a reason and the status *holds* at `requested`, so its
  submitter can read what was wrong and raise a corrected one. Approving clears
  the note.
- **Withdraw** is the submitter pulling their own request back, and only while
  it is still `requested`. After approval it is committed work. It leaves every
  list and count but stays a document, because withdrawing is a thing that
  happened and the Log Book entry recording it has to still resolve.
- **Verification** is a flag on `resolved`, not a state. The submitter says the
  work looks done; an approver still presses Close out. Requests with no Office
  Staff behind them never carry it.

---

## 5. Affordance is not enforcement

`permissions.ts` decides what a padlock looks like and which nav items render.
It runs in the browser, and **it stops nothing**. The route guard in
`shell/auth-gate.tsx` is the same: it exists so nobody lands on a chrome-full
dashboard while signed out, not to protect anything.

The layer that can actually refuse a write is `firestore.rules`, because it
runs on Google's servers. It is **deployed and covers all eleven
collections**, and the matrix above is verified against the emulator rather
than asserted: Office Staff are denied `reports` and the `users` collection,
denied every write to `buildings`, `rooms` and `sensors`, denied
decommissioning a unit and denied advancing a request — while still able to
mark a unit faulty, withdraw their own unapproved request and flag their own
resolved work.

So the two layers say the same thing twice, on purpose, and they have to keep
agreeing: when a `can*` predicate changes, the matching rule belongs in the
same commit. Where they disagree the SDK throws `permission-denied`, and
`(app)/error.tsx` treats that as the app working — a 403 with no retry, not a
crash. A collection a role may not read would answer its subscription the same
way, which is why `useLiveCollection` takes an `enabled` flag and
`useReports(canAccessReports(role))` is the one subscription app-state holds
for a page its role cannot reach.

One consequence worth knowing: **suspension works through the rules rather
than through the app.** A suspended account's own profile read is refused, and
`lib/auth.tsx` turns that `permission-denied` into a sign-out. It looks like a
bug if you do not know that.
