"use client";

// The mechanical half of a Firestore-backed collection, so each store module
// only carries its domain: the mapper and the write rules.
//
// Queries stay single-collection and single-field-ordered. The dataset is a
// few hundred documents, so every UI filter runs client-side and
// `firestore.indexes.json` stays empty. Do not add a `where` here without the
// composite index it will then require.

import {
  type FirestoreError,
  onSnapshot,
  type Query,
} from "firebase/firestore";
import * as React from "react";

export type WriteResult = { ok: true } | { ok: false; message: string };

export const COLLECTIONS = {
  users: "users",
  logBook: "logBook",
  buildings: "buildings",
  rooms: "rooms",
  sensorTypes: "sensorTypes",
  sensors: "sensors",
  equipmentUnits: "equipmentUnits",
  equipmentTypes: "equipmentTypes",
  equipmentHistory: "equipmentHistory",
  requests: "requests",
  reports: "reports",
} as const;

/**
 * Subscribes to a query and keeps the mapped result in state.
 *
 * Live rather than one-shot because the app is built on the promise that an
 * action on one page shows up on every other one — and now, in every other
 * open tab.
 */
export function useLiveCollection<T>(
  query: Query,
  map: (id: string, data: Record<string, unknown>) => T,
  sort?: (a: T, b: T) => number,
  /**
   * False when this role may not read the collection at all.
   *
   * `firestore.rules` is the enforcement layer, so a collection closed to a
   * role answers a subscription with permission-denied — which the provider
   * would surface as a broken shell rather than as the restriction it is.
   * A role that may not read does not ask.
   */
  enabled = true,
): { items: T[]; loading: boolean; error: string | null } {
  const [items, setItems] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // The query object is rebuilt every render, so the effect keys on the
  // caller's promise that it is stable rather than on the object itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query identity changes every render by construction
  React.useEffect(() => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    const unsubscribe = onSnapshot(
      query,
      (snap) => {
        const next = snap.docs.map((d) =>
          map(d.id, d.data() as Record<string, unknown>),
        );
        setItems(sort ? [...next].sort(sort) : next);
        setLoading(false);
        setError(null);
      },
      (cause: FirestoreError) => {
        setLoading(false);
        setError(readError(cause));
      },
    );
    return unsubscribe;
  }, [enabled]);

  return { items, loading, error };
}

export function readError(error: unknown): string {
  const code = errorCode(error);
  if (code === "permission-denied") {
    return "You do not have access to this data.";
  }
  if (code === "unavailable") {
    return "Live data stopped updating. Reconnecting…";
  }
  return "Could not load this data. Check your connection.";
}

/**
 * A failed write, in words a drawer can show.
 *
 * Worth knowing what actually reaches this: offline, Firestore queues the
 * write and the promise does not reject at all, so "you are offline" is not a
 * case. What is left is malformed data and a document over the 1 MiB cap.
 */
export function writeError(error: unknown): string {
  const code = errorCode(error);
  if (code === "permission-denied") {
    return "Your role does not allow that change.";
  }
  if (code === "invalid-argument") {
    return "That could not be saved — the record is too large or malformed.";
  }
  return "Could not save. Check your connection and try again.";
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}
