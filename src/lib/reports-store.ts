"use client";

// Generated reports.
//
// The document is the whole ReportDetail — the figures are snapshotted at
// generation, not recomputed on open. A report is a record of what was true
// for a period; reopening it next month has to show the same numbers, or
// exporting it to PDF and filing it means nothing.

import { collection, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  COLLECTIONS,
  useLiveCollection,
  type WriteResult,
  writeError,
} from "@/lib/firestore-store";
import { toReport } from "@/lib/store-mappers";
import type { ReportDetail, ReportStatus } from "@/lib/types";

/**
 * `enabled` is false for Office Staff, who may not read this collection.
 * Reports is the one subscription app-state holds for a page its role cannot
 * reach, so it is the one that has to be asked for conditionally.
 */
export function useReports(enabled = true) {
  return useLiveCollection(
    collection(db, COLLECTIONS.reports),
    toReport,
    (a, b) => b.generatedAt.localeCompare(a.generatedAt),
    enabled,
  );
}

export async function createReport(report: ReportDetail): Promise<WriteResult> {
  try {
    const { id, ...data } = report;
    await setDoc(doc(db, COLLECTIONS.reports, id), data);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: writeError(error) };
  }
}

export async function setReportStatus(
  reportId: string,
  status: ReportStatus,
): Promise<WriteResult> {
  try {
    await updateDoc(doc(db, COLLECTIONS.reports, reportId), { status });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: writeError(error) };
  }
}
