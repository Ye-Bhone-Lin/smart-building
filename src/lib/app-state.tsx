"use client";

import * as React from "react";
import { type SimulationState, useSimulation } from "@/hooks/use-simulation";
import { countOpenRequests, nextServiceDate } from "@/lib/derive";
import {
  appendHistory,
  createUnit,
  deleteUnitWithHistory,
  moveUnitWrite,
  recordServiceWrite,
  updateUnit,
  useEquipmentHistory,
  useEquipmentUnits,
} from "@/lib/equipment-store";
import {
  useEquipmentTypes,
  writeEquipmentType,
} from "@/lib/equipment-types-store";
import { buildingDeletionRefusal, roomsToCascade } from "@/lib/estate-rules";
import {
  createBuilding,
  createRoom,
  deleteBuildingWithRooms,
  deleteRoom,
  useBuildings,
  useRooms,
  updateBuilding as writeBuilding,
  updateRoom as writeRoom,
} from "@/lib/estate-store";
import type { WriteResult } from "@/lib/firestore-store";
import { formatMmk, parseMmk } from "@/lib/format";
import { appendLogEntry, type LogDraft, useLogBook } from "@/lib/logbook-store";
import {
  buildingName,
  equipmentUnitLabel,
  REQUEST_NEXT_STATUS,
  REQUEST_PREV_STATUS,
  roomLabel,
  sensorType,
  setAssetSource,
  setEquipmentTypeSource,
  setEstateSource,
  setSensorRegistrySource,
} from "@/lib/mock-data";
import {
  type Notification,
  pendingDecisions,
  pruneReadIds,
} from "@/lib/notifications";
import {
  canAccessReports,
  canActOnSensor,
  canAdvanceRequest,
} from "@/lib/permissions";
import { createReport, useReports } from "@/lib/reports-store";
import {
  CLEAR,
  createRequest,
  patchRequestWrite,
  useRequests,
} from "@/lib/requests-store";
import { useSensorTypes, writeSensorType } from "@/lib/sensor-types-store";
import {
  createSensor,
  deleteSensor,
  updateSensor,
  useSensors,
  writeSensorStatus,
} from "@/lib/sensors-store";
import type {
  AppUser,
  Building,
  EnvironmentalSensor,
  EquipmentCondition,
  EquipmentHistoryEvent,
  EquipmentTypeDef,
  EquipmentUnit,
  LogActionType,
  LogBookEntry,
  MaintenanceRequest,
  ReportDetail,
  Room,
  SensorAction,
  SensorStatusDef,
  SensorTypeDef,
  UserRole,
} from "@/lib/types";
import { markNotificationsRead } from "@/lib/users-store";

/**
 * Every registry mutation answers the same way, because each one can be
 * refused for a reason the form has to show — a type still carrying sensors,
 * a status something is sitting in, an action pointing at nothing.
 */
export type RegistryResult = { ok: true } | { ok: false; error: string };

const OK: RegistryResult = { ok: true };

function fail(error: string): RegistryResult {
  return { ok: false, error };
}

/**
 * Ids are generated from the label once and then frozen, so a rename never
 * orphans the sensor records pointing at them. Uniqueness is settled here
 * rather than left to the caller.
 */
export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** The rules a type must satisfy whichever door it came through. */
function validateType(type: SensorTypeDef): RegistryResult {
  if (type.label.trim().length === 0) {
    return fail("A sensor type needs a name.");
  }
  if (type.statuses.length === 0) {
    return fail("A sensor type needs at least one status.");
  }
  const ids = type.statuses.map((st) => st.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) {
    return fail(`Two statuses share the id "${duplicate}".`);
  }
  const empty = type.statuses.find((st) => st.label.trim().length === 0);
  if (empty) return fail("Every status needs a name.");
  const orphan = type.actions.find((a) => !ids.includes(a.resultStatus));
  if (orphan) {
    return fail(
      `"${orphan.label}" results in a status this type does not have.`,
    );
  }
  const actionless = type.actions.find((a) => a.label.trim().length === 0);
  if (actionless) return fail("Every action needs a name.");
  return OK;
}

export interface AppState {
  role: UserRole;
  currentUser: AppUser;
  activeBuildingId: string;
  setActiveBuildingId: (id: string) => void;
  notifications: Notification[];
  unreadCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  // In-memory demo mutations — reset on reload/restart, shared across pages
  // so an action taken on one screen (e.g. Requests) is reflected wherever
  // else that record shows up (e.g. the Dashboard's mini list).

  /** Every request with this session's moves applied. The one list to read. */
  requests: MaintenanceRequest[];
  /** The same list narrowed to what the signed-in role may see. */
  scopedRequests: MaintenanceRequest[];
  /**
   * The open-request count. The sidebar badge, the toolbar chip, the building
   * cards and the dashboard tiles all read this, so they cannot disagree.
   */
  openRequestCount: number;
  /**
   * Every request id in the collection, withdrawn ones included — what a new
   * id has to avoid. `requests` is not enough: it drops withdrawn requests,
   * and the id is the document id, so re-minting one would overwrite it.
   */
  requestIds: string[];
  addRequest: (request: MaintenanceRequest) => Promise<WriteResult>;
  /** Attaches the reason an approver sent a request back. The status holds. */
  declineRequest: (id: string, reason: string) => Promise<WriteResult>;
  /** Its submitter pulls it back before approval; it leaves every list. */
  withdrawRequest: (id: string) => Promise<WriteResult>;
  /** Its submitter says the resolved work looks done. A flag, not a status. */
  requestVerification: (id: string) => Promise<WriteResult>;
  /**
   * Forward one step, or back one step — never more, and the age never resets.
   * `extra` carries what only the resolving step knows: what the work cost.
   */
  moveRequest: (
    id: string,
    direction: "next" | "prev",
    extra?: { costMmk?: number },
  ) => Promise<WriteResult>;
  /** The estate as it stands, not as it was seeded. */
  buildings: Building[];
  rooms: Room[];
  addBuilding: (building: Building) => Promise<WriteResult>;
  updateBuilding: (building: Building) => Promise<WriteResult>;
  /**
   * Deletes the building and every room in it — or refuses, with the counts,
   * while anything that could outlive it still points at it.
   */
  deleteBuilding: (buildingId: string) => Promise<WriteResult>;
  addRoom: (room: Room) => Promise<WriteResult>;
  updateRoom: (room: Room) => Promise<WriteResult>;
  removeRoom: (roomId: string) => Promise<WriteResult>;
  /** The live reading simulation. See hooks/use-simulation.ts. */
  simulation: SimulationState;
  /** Every device on the network. */
  sensors: EnvironmentalSensor[];
  addSensor: (sensor: EnvironmentalSensor) => Promise<WriteResult>;
  /** Registration only: a device's id is frozen once it is on the network. */
  editSensor: (
    sensorId: string,
    patch: Partial<Omit<EnvironmentalSensor, "id">>,
  ) => Promise<WriteResult>;
  /** Takes a device off the network for good. */
  /** `reason` is what the confirm dialog asked for; it is stored on the entry. */
  removeSensor: (sensorId: string, reason?: string) => Promise<WriteResult>;
  setSensorStatus: (
    sensorId: string,
    status: string,
    reading?: number,
    reason?: string,
  ) => Promise<WriteResult>;
  /**
   * The Log Book: what this session wrote, newest first, in front of the seed
   * entries. Every action in the app lands here.
   */
  logBook: LogBookEntry[];
  /** True until the Log Book's first snapshot arrives. */
  logBookLoading: boolean;
  /**
   * True until the collections every page needs have arrived. The shell waits
   * on this once, rather than nine pages each learning about loading.
   */
  dataLoading: boolean;
  /**
   * A live subscription that stopped. Surfaced once in the shell rather than
   * per page — a reader can still work with what is cached.
   */
  dataError: string | null;
  /** Writes one entry. Screens holding their own state call it directly. */
  log: (draft: LogDraft) => void;
  /** The live sensor type registry, archived entries included. */
  sensorTypeRegistry: SensorTypeDef[];
  addSensorType: (
    draft: Omit<SensorTypeDef, "id">,
  ) => Promise<RegistryResult & { id?: string }>;
  /** Everything but the id, which is frozen at creation. */
  updateSensorType: (
    typeId: string,
    patch: Partial<Omit<SensorTypeDef, "id">>,
  ) => Promise<RegistryResult>;
  archiveSensorType: (typeId: string) => Promise<RegistryResult>;
  restoreSensorType: (typeId: string) => Promise<RegistryResult>;
  addSensorStatus: (
    typeId: string,
    draft: Omit<SensorStatusDef, "id">,
  ) => Promise<RegistryResult>;
  updateSensorStatus: (
    typeId: string,
    statusId: string,
    patch: Partial<Omit<SensorStatusDef, "id">>,
  ) => Promise<RegistryResult>;
  removeSensorStatus: (
    typeId: string,
    statusId: string,
  ) => Promise<RegistryResult>;
  addSensorAction: (
    typeId: string,
    draft: Omit<SensorAction, "id">,
  ) => Promise<RegistryResult>;
  updateSensorAction: (
    typeId: string,
    actionId: string,
    patch: Partial<Omit<SensorAction, "id">>,
  ) => Promise<RegistryResult>;
  removeSensorAction: (
    typeId: string,
    actionId: string,
  ) => Promise<RegistryResult>;
  /** Generated reports, newest first. The figures are snapshots. */
  reports: ReportDetail[];
  addReport: (report: ReportDetail) => Promise<WriteResult>;
  /** Every equipment type, archived included — the registry table's list. */
  equipmentTypeRegistry: EquipmentTypeDef[];
  addEquipmentType: (
    label: string,
  ) => Promise<RegistryResult & { id?: string }>;
  renameEquipmentType: (
    typeId: string,
    label: string,
  ) => Promise<RegistryResult>;
  /** Refused while units still carry the type, with the count. */
  archiveEquipmentType: (typeId: string) => Promise<RegistryResult>;
  restoreEquipmentType: (typeId: string) => Promise<RegistryResult>;
  /** The asset register. */
  equipmentUnits: EquipmentUnit[];
  /** Every unit's history, newest first — the drawer filters to its own. */
  equipmentHistory: EquipmentHistoryEvent[];
  addUnit: (unit: EquipmentUnit) => Promise<WriteResult>;
  /** Registration only: the id is the join key and never moves. */
  editUnit: (
    unitId: string,
    patch: Partial<Omit<EquipmentUnit, "id">>,
  ) => Promise<WriteResult>;
  removeUnit: (unitId: string, reason?: string) => Promise<WriteResult>;
  /** Stamps the service, advances the next due date, appends the history row. */
  recordService: (
    unitId: string,
    detail: { parts: string; cost: string },
  ) => Promise<WriteResult>;
  moveUnit: (
    unitId: string,
    to: { buildingId: string; roomId: string },
  ) => Promise<WriteResult>;
  setEquipmentCondition: (
    unitId: string,
    condition: EquipmentCondition,
    reason?: string,
  ) => Promise<WriteResult>;
}

/**
 * A condition change is a history event too. `under-maintenance` has no event
 * of its own in the vocabulary — it is the start of a service, and reads as
 * one on the timeline.
 */
const HISTORY_TYPE_FOR_CONDITION: Record<
  EquipmentCondition,
  EquipmentHistoryEvent["type"]
> = {
  healthy: "returned-to-service",
  faulty: "fault-reported",
  "under-maintenance": "service",
  decommissioned: "decommissioned",
};

const AppStateContext = React.createContext<AppState | null>(null);

/**
 * Mounted inside the auth gate, below a resolved identity — which is why
 * `user` is required rather than nullable, and why signing out unmounts this
 * whole tree and takes every override map and the session log with it. That
 * unmount is what stops one person's work leaking into the next person's
 * session in the same tab.
 */
/**
 * The shortest gap between two automated entries for the same device.
 *
 * Long enough that a flapping sensor cannot bury the journal, short enough
 * that a real sequence — a room warming through three bands over an evening —
 * is still recorded in full. Alarms ignore it entirely.
 */
const AUTO_LOG_FLOOR_MS = 2 * 60_000;

export function AppStateProvider({
  user,
  children,
}: {
  user: AppUser;
  children: React.ReactNode;
}) {
  const role = user.role;
  // Lazily initialised, not set in an effect: an effect would give Office
  // Staff one render scoped to the wrong building.
  const [activeBuildingId, setActiveBuildingIdState] = React.useState(
    () => user.buildingId ?? "b216",
  );
  // The registry is a collection now. Archiving is still the product's
  // "delete", so an archived type keeps resolving labels on the records that
  // name it — the subscription carries archived rows and the pages filter them.
  const {
    items: sensorTypeRegistry,
    loading: sensorTypesLoading,
    error: sensorTypesError,
  } = useSensorTypes();
  const { items: equipmentTypeRegistry } = useEquipmentTypes();
  // The Log Book is the first collection to leave memory. Nothing merges a
  // seed list in front of it any more — the seeded entries are documents.
  const {
    items: logBook,
    loading: logBookLoading,
    error: logBookError,
  } = useLogBook();
  // The estate is editable from Administration and now lives in Firestore, so
  // a renamed building reaches every building filter in the app — and every
  // other open tab — rather than just the tab that renamed it.
  const {
    items: estateBuildings,
    loading: buildingsLoading,
    error: buildingsError,
  } = useBuildings();
  const {
    items: estateRooms,
    loading: roomsLoading,
    error: roomsError,
  } = useRooms();

  // mock-data's sensorType/statusDef accessors read through this, so the page
  // sees an edit on the same render that made it. Assigning the current list
  // is idempotent, which is why it can sit in the render body.
  setSensorRegistrySource(sensorTypeRegistry);
  setEquipmentTypeSource(equipmentTypeRegistry);
  // Same shim, same reason: roomLabel/buildingName/roomsForBuilding resolve
  // through this, so no consumer has to know the estate can change.
  setEstateSource({ buildings: estateBuildings, rooms: estateRooms });

  const setActiveBuildingId = React.useCallback(
    (id: string) => {
      if (role === "office-staff") return;
      setActiveBuildingIdState(id);
    },
    [role],
  );

  const log = React.useCallback(
    (draft: LogDraft) => {
      // Fire-and-forget: an audit side effect must never block the action that
      // caused it, or fail it. Firestore applies the write to the local
      // snapshot before the server acks, so the entry appears immediately.
      void appendLogEntry(draft, user);
    },
    [user],
  );

  const {
    items: allRequests,
    loading: requestsLoading,
    error: requestsError,
  } = useRequests();

  // The one resolved list. A withdrawn request drops out here rather than
  // being filtered again on every screen, so no count can disagree. It stays
  // a field rather than a delete: withdrawing is a thing that happened, and
  // the Log Book entry recording it has to still resolve.
  const requests = React.useMemo(
    () => allRequests.filter((r) => !r.withdrawn),
    [allRequests],
  );

  const requestIds = React.useMemo(
    () => allRequests.map((r) => r.id),
    [allRequests],
  );

  // The bell. Derived from the one request list rather than stored, so a row
  // lasts exactly as long as the decision does — approving one clears it.
  // Read state lives on the profile, which auth.tsx already subscribes to, so
  // it follows the person to another browser.
  const notifications = React.useMemo(
    () =>
      canAdvanceRequest(role)
        ? pendingDecisions(requests, user.readNotifications ?? [], {
            roomLabel,
            buildingName,
          })
        : [],
    [requests, role, user.readNotifications],
  );

  const writeRead = React.useCallback(
    (ids: string[]) => {
      // Pruned to what is still pending: the stored list would otherwise grow
      // forever, and an id left behind would silence a later decision.
      void markNotificationsRead(user.uid, pruneReadIds(ids, notifications));
    },
    [user.uid, notifications],
  );

  const markNotificationRead = React.useCallback(
    (id: string) => {
      const already = notifications.filter((n) => n.read).map((n) => n.id);
      if (already.includes(id)) return;
      writeRead([...already, id]);
    },
    [notifications, writeRead],
  );

  const markAllNotificationsRead = React.useCallback(() => {
    writeRead(notifications.map((n) => n.id));
  }, [notifications, writeRead]);

  const scopedRequests = React.useMemo(
    () =>
      role === "office-staff"
        ? requests.filter((r) => r.buildingId === activeBuildingId)
        : requests,
    [requests, role, activeBuildingId],
  );

  const openRequestCount = React.useMemo(
    () => countOpenRequests(scopedRequests),
    [scopedRequests],
  );

  const addRequest = React.useCallback(
    async (request: MaintenanceRequest) => {
      const written = await createRequest(request);
      if (!written.ok) return written;
      log({
        source: "request",
        actionType: "request-created",
        title: "Request raised",
        detail: `${request.issue} — ${roomLabel(request.roomId)}, ${buildingName(request.buildingId)}.`,
        targetType: "request",
        targetId: request.id,
        buildingId: request.buildingId,
        refId: request.id,
      });
      return written;
    },
    [log],
  );

  const findRequest = React.useCallback(
    (id: string) => allRequests.find((r) => r.id === id),
    [allRequests],
  );

  const moveRequest = React.useCallback(
    async (
      id: string,
      direction: "next" | "prev",
      extra?: { costMmk?: number },
    ) => {
      const base = findRequest(id);
      const current = base?.status ?? "requested";
      const table =
        direction === "next" ? REQUEST_NEXT_STATUS : REQUEST_PREV_STATUS;
      const target = table[current];
      if (!target) return { ok: false as const, message: "Nowhere to move." };
      const written = await patchRequestWrite(id, {
        status: target,
        updatedAt: new Date().toISOString(),
        // Approving answers the note that sent it back, so the note goes —
        // and it has to go explicitly, because `undefined` is ignored.
        ...(current === "requested" ? { declineNote: CLEAR } : {}),
        // Only the resolving step is asked, so only it ever sends this.
        ...(extra?.costMmk !== undefined ? { costMmk: extra.costMmk } : {}),
      });
      if (!written.ok) return written;
      const costNote =
        extra?.costMmk === undefined
          ? ""
          : extra.costMmk === 0
            ? " No cost."
            : ` Cost: ${formatMmk(extra.costMmk)}.`;
      log({
        source: "request",
        actionType: "request-status-changed",
        title:
          target === "approved" && current === "requested"
            ? "Request approved"
            : `Request moved to ${target}`,
        detail: `${id} — ${current} → ${target}.${base ? ` ${base.issue}.` : ""}${costNote}`,
        targetType: "request",
        targetId: id,
        buildingId: base?.buildingId,
        refId: id,
      });
      return written;
    },
    [findRequest, log],
  );

  /** Sends a request back without moving it: the status holds, the reason lands. */
  const declineRequest = React.useCallback(
    async (id: string, reason: string) => {
      const base = findRequest(id);
      const written = await patchRequestWrite(id, { declineNote: reason });
      if (!written.ok) return written;
      log({
        source: "request",
        actionType: "request-declined",
        title: "Request sent back",
        detail: `${id} stays in requested and starts no work.`,
        targetType: "request",
        targetId: id,
        buildingId: base?.buildingId,
        refId: id,
        reason,
      });
      return written;
    },
    [findRequest, log],
  );

  /** Pulled back by its submitter before approval — it leaves every list. */
  const withdrawRequest = React.useCallback(
    async (id: string) => {
      const base = findRequest(id);
      const written = await patchRequestWrite(id, { withdrawn: true });
      if (!written.ok) return written;
      log({
        source: "request",
        actionType: "request-withdrawn",
        title: "Request withdrawn",
        detail: `${id} was withdrawn by its submitter before approval.${base ? ` ${base.issue}.` : ""}`,
        targetType: "request",
        targetId: id,
        buildingId: base?.buildingId,
        refId: id,
      });
      return written;
    },
    [findRequest, log],
  );

  /** The submitter asks for a close-out; an approver still presses it. */
  const requestVerification = React.useCallback(
    async (id: string) => {
      const base = findRequest(id);
      const written = await patchRequestWrite(id, {
        verificationRequested: true,
      });
      if (!written.ok) return written;
      log({
        source: "request",
        actionType: "request-verification-requested",
        title: "Close-out requested",
        detail: `${id} — the submitter says the resolved work looks done.`,
        targetType: "request",
        targetId: id,
        buildingId: base?.buildingId,
        refId: id,
      });
      return written;
    },
    [findRequest, log],
  );

  /**
   * The one resolved device list. A removed sensor drops out here rather than
   * being filtered again on every screen, so the Sensors page and the sensor
   * type registry's "N sensors use this type" guard cannot disagree about what
   * still exists.
   */
  const {
    items: sensors,
    loading: sensorsLoading,
    error: sensorsError,
  } = useSensors();
  const {
    items: equipmentUnits,
    loading: unitsLoading,
    error: unitsError,
  } = useEquipmentUnits();
  const { items: equipmentHistory } = useEquipmentHistory();
  const { items: reports } = useReports(canAccessReports(role));

  // The third holder, beside the estate and the sensor registry:
  // sensorForEquipment / equipmentForSensor / buildingStats are module
  // functions that would otherwise close over the frozen seed arrays and keep
  // answering for them after everything else went live.
  setAssetSource({ units: equipmentUnits, sensors });

  /**
   * When each sensor last had an automated crossing written down.
   *
   * Hysteresis and a sane resting value are what stop a sensor flapping, and
   * both have been wrong at least once — the first time leaving 82% of the Log
   * Book as one drifting thermometer. This is the backstop: a floor between
   * automated entries per device, so a badly set threshold costs a handful of
   * rows an hour rather than a thousand. The sensor document is written every
   * time regardless, so the live screen never lags; only the journal entry is
   * dropped.
   */
  const lastAutoLog = React.useRef<Record<string, number>>({});

  const setSensorStatus = React.useCallback(
    async (
      sensorId: string,
      status: string,
      reading?: number,
      reason?: string,
    ) => {
      const sensor = sensors.find((s) => s.id === sensorId);
      // The stamp goes in with the status, not after it: a status whose tone
      // changes with age is measured from it, so the two are one write.
      const written = await writeSensorStatus(
        sensorId,
        status,
        new Date().toISOString(),
        reading,
      );
      if (!written.ok) return written;
      const type = sensor ? sensorType(sensor.typeId) : undefined;
      const def = type?.statuses.find((st) => st.id === status);

      // The simulation always hands over the reading that caused the crossing;
      // a person resetting an alarm never does. That is the only thing telling
      // the two callers apart, so it is what decides whether this entry is the
      // estate talking or somebody acting.
      const automated = reading !== undefined;
      // An alarm is never held back: a fire detector triggering is the one
      // sensor event nobody may miss because a neighbour was noisy.
      if (automated && !def?.isAlarm) {
        const now = Date.now();
        if (now - (lastAutoLog.current[sensorId] ?? 0) < AUTO_LOG_FLOOR_MS) {
          return written;
        }
        lastAutoLog.current[sensorId] = now;
      }

      log({
        source: def?.isAlarm ? "alert" : "sensor",
        actionType: "sensor-status-changed",
        title: `${type?.label ?? "Sensor"} → ${def?.label ?? status}`,
        detail: sensor
          ? `${sensorId} — ${roomLabel(sensor.roomId)}, ${buildingName(sensor.buildingId)}.`
          : sensorId,
        targetType: "sensor",
        targetId: sensorId,
        buildingId: sensor?.buildingId,
        refId: sensorId,
        reason,
        // The number, not only the state it put the sensor in. The entry is
        // being written anyway, so this is the whole persisted history a
        // reading chart has — see LogBookEntry.reading.
        reading,
        readingUnit: type?.measurement?.unit,
        automated,
      });
      return written;
    },
    [log, sensors],
  );

  // Sensor type registry
  //
  // Every guard below is about records that already point at what is being
  // changed. The registry is free to grow; it is not free to strand a sensor.

  /** Sensors currently sitting in a status. */
  const sensorsInStatus = React.useCallback(
    (typeId: string, statusId: string) =>
      sensors.filter((s) => s.typeId === typeId && s.status === statusId)
        .length,
    [sensors],
  );

  // Validation has to answer the caller now, not on the next render, so the
  // next list is built from the current one here rather than in an updater.
  const patchType = React.useCallback(
    async (
      typeId: string,
      change: (type: SensorTypeDef) => SensorTypeDef,
      entry?: Pick<LogDraft, "actionType" | "title" | "detail">,
    ): Promise<RegistryResult> => {
      const current = sensorTypeRegistry.find((t) => t.id === typeId);
      if (!current) return fail("No sensor type with that id.");
      const next = change(current);
      const check = validateType(next);
      if (!check.ok) return check;
      // The type is written whole. Its statuses and actions are nested arrays
      // on the one document precisely so a change to any of them is one write
      // that either lands or does not — the same unit validateType judges.
      const written = await writeSensorType(next);
      if (!written.ok) return fail(written.message);
      // Every accepted change writes one entry — a refused one writes none,
      // which is why this sits after the validation rather than before it.
      log({
        source: "admin",
        actionType: entry?.actionType ?? "sensor-type-edited",
        title: entry?.title ?? "Sensor type edited",
        detail:
          entry?.detail ??
          `${next.label} — ${next.statuses.length} statuses, ${next.actions.length} actions.`,
        targetType: "sensor",
        targetId: typeId,
      });
      return OK;
    },
    [sensorTypeRegistry, log],
  );

  const addSensorType = React.useCallback(
    async (draft: Omit<SensorTypeDef, "id">) => {
      const id = uniqueId(
        slugify(draft.label),
        sensorTypeRegistry.map((t) => t.id),
      );
      const next = { ...draft, id };
      const check = validateType(next);
      if (!check.ok) return check;
      const written = await writeSensorType(next);
      if (!written.ok) return fail(written.message);
      log({
        source: "admin",
        actionType: "sensor-type-added",
        title: "Sensor type added",
        detail: `${next.label} (${id}) — ${next.statuses.length} statuses, ${next.actions.length} actions.`,
        targetType: "sensor",
        targetId: id,
      });
      return { ok: true as const, id };
    },
    [sensorTypeRegistry, log],
  );

  const updateSensorType = React.useCallback(
    (typeId: string, patch: Partial<Omit<SensorTypeDef, "id">>) =>
      patchType(typeId, (type) => ({ ...type, ...patch })),
    [patchType],
  );

  const archiveSensorType = React.useCallback(
    async (typeId: string): Promise<RegistryResult> => {
      const inUse = sensors.filter((s) => s.typeId === typeId).length;
      if (inUse > 0) {
        const type = sensorTypeRegistry.find((t) => t.id === typeId);
        return fail(
          `${inUse} sensor${inUse === 1 ? " is" : "s are"} registered as ${type?.label ?? typeId}. Move or remove ${inUse === 1 ? "it" : "them"} before archiving the type.`,
        );
      }
      const type = sensorTypeRegistry.find((t) => t.id === typeId);
      return patchType(typeId, (t) => ({ ...t, archived: true }), {
        actionType: "sensor-type-archived",
        title: "Sensor type archived",
        detail: `${type?.label ?? typeId} no longer appears on the Sensors page. Existing records still resolve it.`,
      });
    },
    [patchType, sensorTypeRegistry, sensors],
  );

  const restoreSensorType = React.useCallback(
    (typeId: string) =>
      patchType(typeId, (type) => ({ ...type, archived: false }), {
        actionType: "sensor-type-edited",
        title: "Sensor type restored",
        detail: "It is back in the registry and on the Sensors page.",
      }),
    [patchType],
  );

  const addSensorStatus = React.useCallback(
    (typeId: string, draft: Omit<SensorStatusDef, "id">) =>
      patchType(typeId, (type) => ({
        ...type,
        statuses: [
          ...type.statuses,
          {
            ...draft,
            id: uniqueId(
              slugify(draft.label),
              type.statuses.map((st) => st.id),
            ),
          },
        ],
      })),
    [patchType],
  );

  const updateSensorStatus = React.useCallback(
    (
      typeId: string,
      statusId: string,
      patch: Partial<Omit<SensorStatusDef, "id">>,
    ) =>
      patchType(typeId, (type) => ({
        ...type,
        statuses: type.statuses.map((st) =>
          st.id === statusId ? { ...st, ...patch } : st,
        ),
      })),
    [patchType],
  );

  const removeSensorStatus = React.useCallback(
    async (typeId: string, statusId: string): Promise<RegistryResult> => {
      const occupied = sensorsInStatus(typeId, statusId);
      if (occupied > 0) {
        const label =
          sensorTypeRegistry
            .find((t) => t.id === typeId)
            ?.statuses.find((st) => st.id === statusId)?.label ?? statusId;
        return fail(
          `${occupied} sensor${occupied === 1 ? " is" : "s are"} reporting ${label} right now. That status cannot be removed while anything sits in it.`,
        );
      }
      return patchType(typeId, (type) => ({
        ...type,
        statuses: type.statuses.filter((st) => st.id !== statusId),
      }));
    },
    [patchType, sensorsInStatus, sensorTypeRegistry],
  );

  const addSensorAction = React.useCallback(
    (typeId: string, draft: Omit<SensorAction, "id">) =>
      patchType(typeId, (type) => ({
        ...type,
        actions: [
          ...type.actions,
          {
            ...draft,
            id: uniqueId(
              slugify(draft.label),
              type.actions.map((a) => a.id),
            ),
          },
        ],
      })),
    [patchType],
  );

  const updateSensorAction = React.useCallback(
    (
      typeId: string,
      actionId: string,
      patch: Partial<Omit<SensorAction, "id">>,
    ) =>
      patchType(typeId, (type) => ({
        ...type,
        actions: type.actions.map((a) =>
          a.id === actionId ? { ...a, ...patch } : a,
        ),
      })),
    [patchType],
  );

  const removeSensorAction = React.useCallback(
    (typeId: string, actionId: string) =>
      patchType(typeId, (type) => ({
        ...type,
        actions: type.actions.filter((a) => a.id !== actionId),
      })),
    [patchType],
  );

  // Estate

  const addBuilding = React.useCallback(
    (building: Building) => createBuilding(building),
    [],
  );

  const updateBuilding = React.useCallback(
    (next: Building) => writeBuilding(next),
    [],
  );

  /**
   * Takes its rooms with it — a room cannot outlive the building it is in —
   * but refuses outright while equipment, sensors or open requests still point
   * at the building, rather than leaving them referencing an id that no longer
   * resolves. Same shape as the sensor type registry's archive guard.
   */
  const deleteBuilding = React.useCallback(
    async (buildingId: string) => {
      const refusal = buildingDeletionRefusal(buildingId, {
        units: equipmentUnits,
        sensors,
        requests,
      });
      if (refusal) return { ok: false as const, message: refusal };
      return deleteBuildingWithRooms(
        buildingId,
        roomsToCascade(buildingId, estateRooms).map((r) => r.id),
      );
    },
    [equipmentUnits, sensors, requests, estateRooms],
  );

  const addRoom = React.useCallback((room: Room) => createRoom(room), []);

  const updateRoom = React.useCallback((next: Room) => writeRoom(next), []);

  const removeRoom = React.useCallback(
    (roomId: string) => deleteRoom(roomId),
    [],
  );

  const addSensor = React.useCallback(
    async (sensor: EnvironmentalSensor) => {
      const written = await createSensor(sensor);
      if (!written.ok) return written;
      log({
        source: "sensor",
        actionType: "sensor-status-changed",
        title: "Sensor registered",
        detail: `${sensor.id} — ${sensorType(sensor.typeId)?.label ?? sensor.typeId} in ${roomLabel(sensor.roomId)}, ${buildingName(sensor.buildingId)}.`,
        targetType: "sensor",
        targetId: sensor.id,
        buildingId: sensor.buildingId,
        refId: sensor.id,
      });
      return written;
    },
    [log],
  );

  const editSensor = React.useCallback(
    async (
      sensorId: string,
      patch: Partial<Omit<EnvironmentalSensor, "id">>,
    ) => {
      const written = await updateSensor(sensorId, patch);
      if (!written.ok) return written;
      const next = { ...sensors.find((s) => s.id === sensorId), ...patch };
      log({
        source: "sensor",
        actionType: "sensor-status-changed",
        title: "Sensor registration edited",
        detail: `${sensorId} — ${roomLabel(next.roomId ?? "")}, ${buildingName(next.buildingId ?? "")}.`,
        targetType: "sensor",
        targetId: sensorId,
        buildingId: next.buildingId,
        refId: sensorId,
      });
      return written;
    },
    [log, sensors],
  );

  const removeSensor = React.useCallback(
    async (sensorId: string, reason?: string) => {
      const sensor = sensors.find((s) => s.id === sensorId);
      const written = await deleteSensor(sensorId);
      if (!written.ok) return written;
      log({
        source: "sensor",
        actionType: "sensor-status-changed",
        title: "Sensor removed",
        detail: sensor
          ? `${sensorId} taken off the network — ${roomLabel(sensor.roomId)}, ${buildingName(sensor.buildingId)}.`
          : sensorId,
        targetType: "sensor",
        targetId: sensorId,
        buildingId: sensor?.buildingId,
        refId: sensorId,
        reason,
      });
      return written;
    },
    [log, sensors],
  );

  // The asset register
  //
  // Every write below that changes what happened to a unit also appends the
  // history row that says so, in one batch. A register whose dates moved
  // without a row is the drawer quietly lying about what was done to it.

  const actorName = user.name;

  const addReport = React.useCallback(
    async (report: ReportDetail) => {
      const written = await createReport(report);
      if (!written.ok) return written;
      log({
        source: "admin",
        actionType: "report-generated",
        title: "Report generated",
        detail: `${report.id} — ${report.kind.replace(/-/g, " ")}, ${report.period}${report.buildingId ? `, ${buildingName(report.buildingId)}` : ", whole estate"}.`,
        targetType: "report",
        targetId: report.id,
        buildingId: report.buildingId,
        refId: report.id,
      });
      return written;
    },
    [log],
  );

  // The equipment type registry. Same guard as the sensor one: a type is free
  // to be added, it is not free to strand a unit.

  const logType = React.useCallback(
    (action: LogActionType, title: string, type: EquipmentTypeDef) => {
      log({
        source: "admin",
        actionType: action,
        title,
        detail: `${type.label} (${type.id}).`,
        targetType: "equipment",
        targetId: type.id,
      });
    },
    [log],
  );

  const addEquipmentType = React.useCallback(
    async (label: string) => {
      const clean = label.trim();
      if (clean.length === 0) return fail("An equipment type needs a name.");
      const id = uniqueId(
        slugify(clean),
        equipmentTypeRegistry.map((t) => t.id),
      );
      const next = { id, label: clean, archived: false };
      const written = await writeEquipmentType(next);
      if (!written.ok) return fail(written.message);
      logType("equipment-type-added", "Equipment type added", next);
      return { ok: true as const, id };
    },
    [equipmentTypeRegistry, logType],
  );

  const renameEquipmentType = React.useCallback(
    async (typeId: string, label: string): Promise<RegistryResult> => {
      const clean = label.trim();
      if (clean.length === 0) return fail("An equipment type needs a name.");
      const current = equipmentTypeRegistry.find((t) => t.id === typeId);
      if (!current) return fail("No equipment type with that id.");
      const next = { ...current, label: clean };
      const written = await writeEquipmentType(next);
      if (!written.ok) return fail(written.message);
      logType("equipment-type-edited", "Equipment type renamed", next);
      return OK;
    },
    [equipmentTypeRegistry, logType],
  );

  const archiveEquipmentType = React.useCallback(
    async (typeId: string): Promise<RegistryResult> => {
      const current = equipmentTypeRegistry.find((t) => t.id === typeId);
      if (!current) return fail("No equipment type with that id.");
      const inUse = equipmentUnits.filter((u) => u.typeId === typeId).length;
      if (inUse > 0) {
        return fail(
          `${inUse} unit${inUse === 1 ? " is" : "s are"} registered as ${current.label}. Move or delete ${inUse === 1 ? "it" : "them"} before archiving the type.`,
        );
      }
      const next = { ...current, archived: true };
      const written = await writeEquipmentType(next);
      if (!written.ok) return fail(written.message);
      logType("equipment-type-archived", "Equipment type archived", next);
      return OK;
    },
    [equipmentTypeRegistry, equipmentUnits, logType],
  );

  const restoreEquipmentType = React.useCallback(
    async (typeId: string): Promise<RegistryResult> => {
      const current = equipmentTypeRegistry.find((t) => t.id === typeId);
      if (!current) return fail("No equipment type with that id.");
      const next = { ...current, archived: false };
      const written = await writeEquipmentType(next);
      if (!written.ok) return fail(written.message);
      logType("equipment-type-edited", "Equipment type restored", next);
      return OK;
    },
    [equipmentTypeRegistry, logType],
  );

  // The tick reads the latest writer rather than closing over one, so the
  // interval is not rebuilt every time a snapshot arrives.
  const setSensorStatusRef = React.useRef(setSensorStatus);
  setSensorStatusRef.current = setSensorStatus;

  // The estate, ticking. One per tab, and only for someone who could act on a
  // sensor anyway — an Office Staff tab should not be writing status changes
  // the whole estate then sees.
  const simulation = useSimulation({
    sensors,
    types: sensorTypeRegistry,
    units: equipmentUnits,
    roomTypeOf: (roomId) => estateRooms.find((r) => r.id === roomId)?.type,
    enabled: canActOnSensor(role),
    onCrossing: (sensorId, status, reading) => {
      void setSensorStatusRef.current(sensorId, status, reading);
    },
  });

  const addUnit = React.useCallback(
    async (unit: EquipmentUnit) => {
      const written = await createUnit(unit);
      if (!written.ok) return written;
      await appendHistory({
        equipmentUnitId: unit.id,
        type: "installed",
        at: new Date().toISOString(),
        summary: `Added to the register in ${roomLabel(unit.roomId)}`,
        actorName,
      });
      log({
        source: "equipment",
        actionType: "equipment-status-changed",
        title: "Unit added to the register",
        detail: `${unit.tag} — ${roomLabel(unit.roomId)}, ${buildingName(unit.buildingId)}.`,
        targetType: "equipment",
        targetId: unit.id,
        buildingId: unit.buildingId,
        refId: unit.tag,
      });
      return written;
    },
    [actorName, log],
  );

  const editUnit = React.useCallback(
    async (unitId: string, patch: Partial<Omit<EquipmentUnit, "id">>) => {
      const before = equipmentUnits.find((u) => u.id === unitId);
      const written = await updateUnit(unitId, patch);
      if (!written.ok) return written;
      const next = { ...before, ...patch };

      // Changing what a unit is *doing* is a thing that happened to it, so it
      // gets a history row like every other such write — this was the one
      // that did not, and without it there is no record of when a room was
      // put on cooling, only that it is now.
      if (patch.hvac) {
        const h = patch.hvac;
        await appendHistory({
          equipmentUnitId: unitId,
          type: "setting-changed",
          at: new Date().toISOString(),
          summary:
            h.mode === "off"
              ? "Switched off"
              : `Set to ${h.mode} at ${h.setpointC} °C, fan ${h.fan}`,
          actorName,
        });
      }

      log({
        source: "equipment",
        actionType: "equipment-status-changed",
        title: patch.hvac ? "Climate control changed" : "Unit details edited",
        detail: patch.hvac
          ? `${next.tag ?? unitId} — ${
              patch.hvac.mode === "off"
                ? "switched off"
                : `${patch.hvac.mode} to ${patch.hvac.setpointC} °C, fan ${patch.hvac.fan}`
            }.`
          : `${next.tag ?? unitId} — registration saved.`,
        targetType: "equipment",
        targetId: unitId,
        buildingId: next.buildingId,
        refId: next.tag ?? unitId,
      });
      return written;
    },
    [actorName, equipmentUnits, log],
  );

  const removeUnit = React.useCallback(
    async (unitId: string, reason?: string) => {
      const unit = equipmentUnits.find((u) => u.id === unitId);
      const written = await deleteUnitWithHistory(unitId);
      if (!written.ok) return written;
      log({
        source: "equipment",
        actionType: "equipment-status-changed",
        title: "Unit deleted from the register",
        detail: unit
          ? `${unit.tag} — ${roomLabel(unit.roomId)}, ${buildingName(unit.buildingId)}.`
          : unitId,
        targetType: "equipment",
        targetId: unitId,
        buildingId: unit?.buildingId,
        refId: unit?.tag ?? unitId,
        reason,
      });
      return written;
    },
    [equipmentUnits, log],
  );

  const recordService = React.useCallback(
    async (unitId: string, detail: { parts: string; cost: string }) => {
      const unit = equipmentUnits.find((u) => u.id === unitId);
      if (!unit) return { ok: false as const, message: "No such unit." };
      const at = new Date().toISOString();
      // The form has always collected a cost and only ever written it into the
      // summary. Kept as a number too, so the cost report can see servicing
      // and not just request work.
      const costMmk = parseMmk(detail.cost) ?? undefined;
      const summary = [
        detail.parts.trim() || "Service carried out",
        // Through formatMmk, so a typed 92000 reads back as "92,000 MMK" like
        // every other amount in the app. A drawer of history rows where one
        // says "145,000 MMK" and the next says "92000" is the record looking
        // untrustworthy over a missing comma. Anything that is not a number
        // is kept exactly as typed rather than dropped.
        costMmk !== undefined ? formatMmk(costMmk) : detail.cost.trim(),
      ]
        .filter(Boolean)
        .join(" · ");
      const written = await recordServiceWrite(
        unitId,
        {
          lastServiceAt: at,
          nextServiceDue: nextServiceDate(at, unit.serviceIntervalDays),
        },
        {
          equipmentUnitId: unitId,
          type: "service",
          at,
          summary,
          actorName,
          ...(costMmk !== undefined ? { costMmk } : {}),
        },
      );
      if (!written.ok) return written;
      log({
        source: "equipment",
        actionType: "equipment-status-changed",
        title: "Service recorded",
        detail: `${unit.tag} — ${roomLabel(unit.roomId)}, ${buildingName(unit.buildingId)}.`,
        targetType: "equipment",
        targetId: unitId,
        buildingId: unit.buildingId,
        refId: unit.tag,
      });
      return written;
    },
    [actorName, equipmentUnits, log],
  );

  const moveUnit = React.useCallback(
    async (unitId: string, to: { buildingId: string; roomId: string }) => {
      const unit = equipmentUnits.find((u) => u.id === unitId);
      if (!unit) return { ok: false as const, message: "No such unit." };
      const from = unit.roomId;
      const written = await moveUnitWrite(unitId, to, {
        equipmentUnitId: unitId,
        type: "moved",
        at: new Date().toISOString(),
        summary: `${roomLabel(from)} → ${roomLabel(to.roomId)}`,
        actorName,
      });
      if (!written.ok) return written;
      log({
        source: "equipment",
        actionType: "equipment-status-changed",
        title: "Unit moved",
        detail: `${unit.tag} — ${roomLabel(from)} → ${roomLabel(to.roomId)}, ${buildingName(to.buildingId)}.`,
        targetType: "equipment",
        targetId: unitId,
        buildingId: to.buildingId,
        refId: unit.tag,
      });
      return written;
    },
    [actorName, equipmentUnits, log],
  );

  const setEquipmentCondition = React.useCallback(
    async (unitId: string, condition: EquipmentCondition, reason?: string) => {
      const unit = equipmentUnits.find((u) => u.id === unitId);
      const written = await updateUnit(unitId, { condition });
      if (!written.ok) return written;
      // A condition change is part of the asset's story, not only the estate's,
      // so it lands in the unit's own history as well as the Log Book.
      await appendHistory({
        equipmentUnitId: unitId,
        type: HISTORY_TYPE_FOR_CONDITION[condition],
        at: new Date().toISOString(),
        summary: reason
          ? `Marked ${condition.replace("-", " ")} — ${reason}`
          : `Marked ${condition.replace("-", " ")}`,
        actorName,
      });
      log({
        source: "equipment",
        actionType: "equipment-status-changed",
        title: `Equipment marked ${condition.replace("-", " ")}`,
        detail: unit
          ? `${equipmentUnitLabel(unit)} — ${roomLabel(unit.roomId)}, ${buildingName(unit.buildingId)}.`
          : unitId,
        targetType: "equipment",
        targetId: unitId,
        buildingId: unit?.buildingId,
        refId: unit?.tag ?? unitId,
        reason,
      });
      return written;
    },
    [actorName, equipmentUnits, log],
  );

  const value = React.useMemo<AppState>(
    () => ({
      role,
      currentUser: user,
      activeBuildingId,
      setActiveBuildingId,
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      markNotificationRead,
      markAllNotificationsRead,
      requests,
      scopedRequests,
      openRequestCount,
      requestIds,
      addRequest,
      declineRequest,
      withdrawRequest,
      requestVerification,
      moveRequest,
      buildings: estateBuildings,
      rooms: estateRooms,
      addBuilding,
      updateBuilding,
      deleteBuilding,
      addRoom,
      updateRoom,
      removeRoom,
      sensors,
      simulation,
      addSensor,
      editSensor,
      removeSensor,
      setSensorStatus,
      logBook,
      logBookLoading,
      dataLoading:
        buildingsLoading ||
        roomsLoading ||
        sensorTypesLoading ||
        sensorsLoading ||
        unitsLoading ||
        requestsLoading,
      dataError:
        buildingsError ??
        roomsError ??
        sensorTypesError ??
        sensorsError ??
        unitsError ??
        requestsError ??
        logBookError,
      log,
      sensorTypeRegistry,
      addSensorType,
      updateSensorType,
      archiveSensorType,
      restoreSensorType,
      addSensorStatus,
      updateSensorStatus,
      removeSensorStatus,
      addSensorAction,
      updateSensorAction,
      removeSensorAction,
      reports,
      addReport,
      equipmentTypeRegistry,
      addEquipmentType,
      renameEquipmentType,
      archiveEquipmentType,
      restoreEquipmentType,
      equipmentUnits,
      equipmentHistory,
      addUnit,
      editUnit,
      removeUnit,
      recordService,
      moveUnit,
      setEquipmentCondition,
    }),
    [
      role,
      user,
      activeBuildingId,
      setActiveBuildingId,
      notifications,
      markNotificationRead,
      markAllNotificationsRead,
      requests,
      scopedRequests,
      openRequestCount,
      requestIds,
      addRequest,
      declineRequest,
      withdrawRequest,
      requestVerification,
      moveRequest,
      estateBuildings,
      estateRooms,
      addBuilding,
      updateBuilding,
      deleteBuilding,
      addRoom,
      updateRoom,
      removeRoom,
      sensors,
      simulation,
      addSensor,
      editSensor,
      removeSensor,
      setSensorStatus,
      logBook,
      logBookLoading,
      logBookError,
      buildingsLoading,
      sensorTypesLoading,
      sensorTypesError,
      sensorsLoading,
      sensorsError,
      unitsLoading,
      unitsError,
      requestsLoading,
      requestsError,
      buildingsError,
      roomsLoading,
      roomsError,
      log,
      sensorTypeRegistry,
      addSensorType,
      updateSensorType,
      archiveSensorType,
      restoreSensorType,
      addSensorStatus,
      updateSensorStatus,
      removeSensorStatus,
      addSensorAction,
      updateSensorAction,
      removeSensorAction,
      reports,
      addReport,
      equipmentTypeRegistry,
      addEquipmentType,
      renameEquipmentType,
      archiveEquipmentType,
      restoreEquipmentType,
      equipmentUnits,
      equipmentHistory,
      addUnit,
      editUnit,
      removeUnit,
      recordService,
      moveUnit,
      setEquipmentCondition,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = React.useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
