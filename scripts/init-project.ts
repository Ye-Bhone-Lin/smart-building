// Sets up an empty Firebase project so the app is usable: one CEO account and
// the estate it manages. No requests, no Log Book, no history, no reports —
// those are what you create by using the app.
//
//   pnpm init:project                 # create everything
//   pnpm init:project --dry-run       # say what it would do
//   pnpm init:project --reset         # wipe the WHOLE database first
//   pnpm init:project --reset --yes   # ... without being asked to confirm
//   pnpm init:project --reset-auth    # ... and delete the Auth accounts too
//
// Runs under vite-node rather than node so it can import the estate from
// src/lib/mock-data.ts directly, instead of keeping a second copy that drifts.
//
// Safe to run twice: documents keep their ids and are merged, and an existing
// CEO account is signed into rather than recreated.
//
// Three accounts are created, one per role, so every part of the app can be
// seen without inventing an account first. Override any address with
// CEO_EMAIL / ADMIN_EMAIL / STAFF_EMAIL, and the shared password with
// INIT_PASSWORD.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { DEFAULT_SERVICE_INTERVAL_DAYS } from "../src/lib/derive";
import {
  BUILDINGS,
  EQUIPMENT_TYPES,
  EQUIPMENT_UNITS,
  ROOMS,
  SENSOR_TYPES,
  SENSORS,
} from "../src/lib/mock-data";

const DRY_RUN = process.argv.includes("--dry-run");
const RESET_AUTH = process.argv.includes("--reset-auth");
const RESET = process.argv.includes("--reset") || RESET_AUTH;

const PASSWORD = process.env.INIT_PASSWORD ?? "SmartPassword!";

/**
 * The passwords an account here could have been given: this run's, and the one
 * the app hands a newly created account (`INITIAL_PASSWORD` in users-store).
 * Deleting an Auth record needs a signed-in session as that very account, so
 * the only ones reachable without an admin key are those we can guess.
 */
const KNOWN_PASSWORDS = [PASSWORD, "SmartPassword!"];

/** One account per role. Office Staff are scoped to a building; nobody else. */
const ACCOUNTS = [
  {
    email: process.env.CEO_EMAIL ?? "daw.htun@university.edu",
    name: process.env.CEO_NAME ?? "Daw Htun",
    role: "ceo-super-admin",
    buildingId: null,
  },
  {
    email: process.env.ADMIN_EMAIL ?? "elysha@university.edu",
    name: process.env.ADMIN_NAME ?? "Elysha",
    role: "admin-manager",
    buildingId: null,
  },
  {
    email: process.env.STAFF_EMAIL ?? "hnin.nwe@university.edu",
    name: process.env.STAFF_NAME ?? "Hnin Nwe",
    role: "office-staff",
    buildingId: "b216",
  },
] as const;

/** What this script writes. */
const ESTATE = [
  "buildings",
  "rooms",
  "equipmentTypes",
  "equipmentUnits",
  "sensorTypes",
  "sensors",
] as const;

/**
 * What --reset deletes: everything, not just what gets rewritten. A reset that
 * left the last person's requests and log entries behind was not one.
 */
const ALL_COLLECTIONS = [
  ...ESTATE,
  "requests",
  "logBook",
  "equipmentHistory",
  "reports",
  "users",
] as const;

/**
 * Parents whose photos live in a `media` subcollection. Deleting a document
 * does not delete its subcollections, so these have to be walked or the
 * photos become unreachable rather than gone.
 */
const WITH_PHOTOS = ["equipmentUnits", "buildings"] as const;

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(".env.local", "utf8");
  } catch {
    throw new Error("No .env.local found. Copy .env.example and fill it in.");
  }
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  if (!env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    throw new Error(".env.local has no NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  }
  return env;
}

const env = loadEnv();
const app = initializeApp({
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

// The same flag the app reads, so `NEXT_PUBLIC_FIREBASE_EMULATORS=1 pnpm
// init:project` fills the emulator suite rather than the real project — which
// is how the security rules get exercised without deploying them.
if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  console.log("Using the local emulator suite (auth :9099, firestore :8080)\n");
}

/** Firestore caps a batch at 500 operations. */
const BATCH_LIMIT = 500;

async function writeAll(
  name: string,
  rows: { id: string; data: Record<string, unknown> }[],
): Promise<void> {
  if (DRY_RUN) {
    console.log(`  ${name.padEnd(16)} would write ${rows.length}`);
    return;
  }
  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const row of rows.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(db, name, row.id), row.data, { merge: true });
    }
    await batch.commit();
  }
  console.log(`  ${name.padEnd(16)} wrote ${rows.length}`);
}

async function clear(name: string): Promise<void> {
  const snap = await getDocs(collection(db, name));
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
    await batch.commit();
  }
  console.log(`  ${name.padEnd(16)} cleared ${snap.docs.length}`);
}

/** A photo lives at `{parent}/{id}/media/photo` and outlives its parent. */
async function clearPhotos(parent: string): Promise<void> {
  const snap = await getDocs(collection(db, parent));
  let removed = 0;
  for (const d of snap.docs) {
    const media = await getDocs(collection(db, parent, d.id, "media"));
    for (const m of media.docs) {
      await deleteDoc(m.ref);
      removed += 1;
    }
  }
  if (removed > 0) {
    console.log(`  ${`${parent}/media`.padEnd(16)} cleared ${removed}`);
  }
}

/** Typed at the terminal, because --reset now deletes everything. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question}\n  Type "delete" to confirm: `);
  rl.close();
  return answer.trim().toLowerCase() === "delete";
}

/** Creates the account, or signs in to an existing one to recover its uid. */
async function ensureAccount(email: string): Promise<string> {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
    console.log(`  + ${email} created`);
    return cred.user.uid;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/email-already-in-use") throw error;
    // Already there from an earlier run. Signing in is how a client-SDK
    // script recovers the uid — there is no admin lookup without a key.
    try {
      const cred = await signInWithEmailAndPassword(auth, email, PASSWORD);
      console.log(`  · ${email} already exists`);
      return cred.user.uid;
    } catch (signInError) {
      const signInCode = (signInError as { code?: string }).code;
      if (signInCode !== "auth/invalid-credential") throw signInError;
      throw new Error(
        `${email} already exists with a different password, and this script ` +
          `cannot read a uid without signing in.\n\n` +
          `Either run it with the password that account already has:\n` +
          `  INIT_PASSWORD='the-existing-one' pnpm init:project\n\n` +
          `or delete the account in the Firebase console under\n` +
          `Authentication → Users, and run this again.`,
      );
    }
  }
}

/**
 * Every address the `users` collection knows about.
 *
 * There is no admin listUsers without a service-account key, so the profiles
 * are the only census of the Auth records this project made. An Auth record
 * whose profile was already deleted is invisible here and has to go in the
 * console.
 */
async function knownEmails(): Promise<string[]> {
  const snap = await getDocs(collection(db, "users"));
  const found = snap.docs
    .map((d) => (d.data() as { email?: string }).email)
    .filter((e): e is string => typeof e === "string");
  return [...new Set([...found, ...ACCOUNTS.map((a) => a.email)])];
}

/**
 * Deletes the Auth records, by signing in as each one and asking it to remove
 * itself — the only route the client SDK offers. Anything whose password is
 * not one of KNOWN_PASSWORDS is reported rather than silently skipped, because
 * a half-cleared Auth list is worse than one you know the shape of.
 */
async function purgeAuth(emails: string[]): Promise<void> {
  console.log("\nDeleting Auth accounts:");
  const stubborn: string[] = [];
  for (const email of emails) {
    let done = false;
    for (const pw of KNOWN_PASSWORDS) {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, pw);
        await deleteUser(cred.user);
        console.log(`  - ${email} deleted`);
        done = true;
        break;
      } catch {
        // Wrong password, or the record is already gone. Try the next one.
      }
    }
    if (!done) {
      stubborn.push(email);
      console.log(`  ! ${email} could not be signed into — left in place`);
    }
  }
  if (stubborn.length > 0) {
    console.log(
      `\n  ${stubborn.length} account(s) need a password this script does ` +
        `not have.\n  Delete them by hand under Authentication → Users:\n` +
        `  https://console.firebase.google.com/project/${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}/authentication/users`,
    );
  }
}

async function main(): Promise<void> {
  console.log(
    `Setting up ${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}${DRY_RUN ? " (dry run)" : ""}\n`,
  );

  // The wipe runs before the accounts are made, not after: --reset-auth
  // deletes the very records the account step would otherwise have just
  // created, and reading the `users` collection for the address list has to
  // happen while those documents still exist.
  if (RESET && !DRY_RUN) {
    if (!process.argv.includes("--yes")) {
      const ok = await confirm(
        `Delete EVERY document in ${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}` +
          `${RESET_AUTH ? ", and every Auth account it can sign into" : ""}?`,
      );
      if (!ok) {
        console.log("Nothing was deleted.");
        process.exit(0);
      }
    }

    // Clearing needs a signed-in session, so borrow the CEO's if it is there.
    // A project with no account yet has nothing to clear either.
    let emails: string[] = ACCOUNTS.map((a) => a.email);
    try {
      await signInWithEmailAndPassword(auth, ACCOUNTS[0].email, PASSWORD);
      if (RESET_AUTH) emails = await knownEmails();
      console.log("\nClearing:");
      for (const parent of WITH_PHOTOS) await clearPhotos(parent);
      for (const name of ALL_COLLECTIONS) await clear(name);
    } catch {
      console.log("\n  Nothing to clear — no account to sign in with yet.");
    }

    if (RESET_AUTH) {
      await purgeAuth(emails);
      await signOut(auth).catch(() => {});
    } else {
      console.log(
        "\n  Auth accounts are NOT deleted — the client SDK cannot remove\n" +
          "  another user's record. They will sign in and land on 'no profile'\n" +
          "  until the accounts below are recreated. Pass --reset-auth to\n" +
          "  delete the ones this script can sign into, or clear them all at:\n" +
          `  https://console.firebase.google.com/project/${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}/authentication/users`,
      );
    }
  }

  console.log("Accounts:");
  if (DRY_RUN) {
    for (const a of ACCOUNTS) {
      console.log(`  would create ${a.email.padEnd(26)} ${a.role}`);
    }
  } else {
    // Every account is created first, then the profiles are written while
    // signed in as the CEO — creating an account signs you in as it, and the
    // last one created would otherwise be the one writing everybody's role.
    const uids: string[] = [];
    for (const a of ACCOUNTS) uids.push(await ensureAccount(a.email));

    await signInWithEmailAndPassword(auth, ACCOUNTS[0].email, PASSWORD);
    for (const [i, a] of ACCOUNTS.entries()) {
      // Nobody sets their own role, so the CEO cannot rewrite the profile they
      // are signed in as. On a re-run it is already correct; on a first run it
      // has to be seeded before the rules are live. Either way, skip it.
      if (i === 0 && (await getDoc(doc(db, "users", uids[0]))).exists()) {
        console.log(`  · ${a.email.padEnd(26)} own profile left as it is`);
        continue;
      }
      await setDoc(
        doc(db, "users", uids[i]),
        {
          email: a.email,
          name: a.name,
          role: a.role,
          buildingId: a.buildingId,
          status: "active",
          lastActiveAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );
      console.log(`  · ${a.email.padEnd(26)} profile written as ${a.role}`);
    }
  }

  console.log(`\n${DRY_RUN ? "Would write:" : "Writing:"}`);

  await writeAll(
    "buildings",
    BUILDINGS.map(({ id, ...data }) => ({ id, data })),
  );
  await writeAll(
    "rooms",
    ROOMS.map(({ id, ...data }) => ({ id, data })),
  );
  await writeAll(
    "equipmentTypes",
    EQUIPMENT_TYPES.map(({ id, ...data }) => ({ id, data })),
  );
  await writeAll(
    "equipmentUnits",
    EQUIPMENT_UNITS.map(({ id, ...data }) => ({
      id,
      data: { ...data, serviceIntervalDays: DEFAULT_SERVICE_INTERVAL_DAYS },
    })),
  );
  await writeAll(
    "sensorTypes",
    SENSOR_TYPES.map(({ id, ...data }) => ({ id, data })),
  );
  // statusChangedAt is seeded from the last report: the estate has no record
  // of when a device entered its status, and dating it from the report is the
  // only answer that is not invented.
  await writeAll(
    "sensors",
    SENSORS.map(({ id, ...data }) => ({
      id,
      data: { ...data, statusChangedAt: data.updatedAt },
    })),
  );

  if (!DRY_RUN) await signOut(auth);

  const rows = ACCOUNTS.map((a) => `  ${a.email.padEnd(26)} ${a.role}`).join(
    "\n",
  );
  console.log(`
Done. Sign in at http://localhost:3000/login

${rows}

  password for all three: ${PASSWORD}

There is no role switcher — to see another role, sign in as it.

No requests, Log Book entries, equipment history or reports were created;
those appear as you use the app.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
