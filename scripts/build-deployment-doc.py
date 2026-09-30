from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import os

SHOTS = "docs/testing/shots"
doc = Document()

# ---- base styles ----
st = doc.styles["Normal"]
st.font.name = "Calibri"; st.font.size = Pt(10.5)
st.paragraph_format.space_after = Pt(6)
st.paragraph_format.line_spacing = 1.15

def shade(cell, hexv):
    el = OxmlElement("w:shd"); el.set(qn("w:val"),"clear"); el.set(qn("w:fill"),hexv)
    cell._tc.get_or_add_tcPr().append(el)

def h(text, level=1):
    p = doc.add_heading(text, level=level)
    for r in p.runs:
        r.font.color.rgb = RGBColor(0x1F,0x35,0x64)
        r.font.name = "Calibri"
    return p

def para(text, italic=False, bold=False, size=10.5):
    p = doc.add_paragraph()
    r = p.add_run(text); r.italic = italic; r.bold = bold; r.font.size = Pt(size)
    return p

def bullets(items):
    for i in items:
        doc.add_paragraph(i, style="List Bullet")

def steps(items):
    # Numbered by hand rather than with the List Number style: Word continues
    # that style's sequence across the whole document, so section 6.2 carried
    # on from 6.1 at "13." instead of restarting at "1.".
    for n, i in enumerate(items, 1):
        para_ = doc.add_paragraph()
        para_.paragraph_format.left_indent = Inches(0.3)
        para_.paragraph_format.first_line_indent = Inches(-0.3)
        para_.paragraph_format.space_after = Pt(3)
        r = para_.add_run(f"{n}.  "); r.bold = True; r.font.size = Pt(10.5)
        r2 = para_.add_run(i); r2.font.size = Pt(10.5)

def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, htext in enumerate(headers):
        hdr[i].text = ""
        r = hdr[i].paragraphs[0].add_run(htext); r.bold = True; r.font.size = Pt(9.5)
        shade(hdr[i], "1F3564")
        r.font.color.rgb = RGBColor(0xFF,0xFF,0xFF)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            r = cells[i].paragraphs[0].add_run(str(v)); r.font.size = Pt(9.5)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Inches(w)
    doc.add_paragraph()
    return t

def code(text):
    p = doc.add_paragraph()
    r = p.add_run(text); r.font.name = "Consolas"; r.font.size = Pt(9)
    p.paragraph_format.left_indent = Inches(0.25)
    p.paragraph_format.space_after = Pt(8)
    pr = p._p.get_or_add_pPr()
    sh = OxmlElement("w:shd"); sh.set(qn("w:val"),"clear"); sh.set(qn("w:fill"),"F2F3F5")
    pr.append(sh)
    return p

def figure(fname, caption, width=6.2):
    path = os.path.join(SHOTS, fname)
    if not os.path.exists(path):
        para(f"[missing screenshot: {fname}]", italic=True); return
    doc.add_picture(path, width=Inches(width))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    c = doc.add_paragraph(); c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = c.add_run(caption); r.italic = True; r.font.size = Pt(9)
    r.font.color.rgb = RGBColor(0x55,0x5B,0x66)

# ============================ TITLE ============================
t = doc.add_heading("Deployment Document", level=0)
for r in t.runs: r.font.color.rgb = RGBColor(0x1F,0x35,0x64)
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.LEFT
r = p.add_run("Smart Building Monitoring — Facilities Operations Dashboard")
r.bold = True; r.font.size = Pt(13)
para("CET333 Product Development · Task 7 (Deployment)", size=10)
para("Next.js 16 · React 19 · TypeScript · Firebase Authentication and Cloud Firestore", size=10)
doc.add_paragraph()

h("Contents", 1)
bullets([
 "1. How the system will be deployed",
 "2. Hardware requirements",
 "3. Software requirements",
 "4. Installation procedure",
 "5. Configuration",
 "6. User documentation",
 "7. Maintenance considerations",
])
doc.add_page_break()

# ============================ 1. DEPLOYMENT ============================
h("1. How the system will be deployed", 1)
para("The system deploys as two halves that are hosted separately and never share a machine.")
para("The first half is the application itself: a Next.js front end compiled to static HTML, CSS and JavaScript. "
     "Sixteen of its seventeen routes are prerendered at build time and served as files from a content delivery "
     "network. Only the catch-all 404 route is rendered on demand. There is no application server to provision, "
     "patch or scale.")
para("The second half is the data: Firebase Authentication and Cloud Firestore, both managed by Google. Every page "
     "opens a live onSnapshot subscription, so a change made by one person appears on another person's screen "
     "without a refresh and without any polling code. Authorisation is enforced by Firestore security rules, which "
     "run on Google's servers rather than in the browser.")
para("The practical consequence is that deployment is a file upload plus a rules deployment. There is no database "
     "to install, no connection string, no server operating system, and nothing listening on a port that the "
     "university would have to firewall.")

h("1.1 Deployment topology", 2)
table(["Layer","What is deployed","Where it runs","Who operates it"],
[["Client","Compiled HTML, CSS, JavaScript (3.2 MB static, 2.6 MB JavaScript)","The end user's web browser","The user"],
 ["Hosting","The same compiled output, served over HTTPS","Vercel or Firebase Hosting CDN","The hosting provider"],
 ["Authentication","Email and password identity, session tokens","Firebase Authentication (Google)","Google"],
 ["Database","Eleven Firestore collections","Cloud Firestore, europe-west or nearest region","Google"],
 ["Authorisation","firestore.rules","Cloud Firestore rules engine","Deployed by the administrator"]],
 [1.0,2.2,1.9,1.3])

h("1.2 Deployment environments", 2)
table(["Environment","Purpose","Data","How it is started"],
[["Local development","Day-to-day coding","The developer's own Firebase project","pnpm dev"],
 ["Local emulator","Testing rules and destructive actions safely","Throw-away, in memory","firebase emulators:start"],
 ["Production","The live system","The live Firebase project","pnpm build, then deploy"]],
 [1.5,2.0,1.9,1.4])
doc.add_page_break()

# ============================ 2. HARDWARE ============================
h("2. Hardware requirements", 1)
para("Because the application is a static front end talking to a managed database, there is no server hardware to "
     "specify. The requirements fall into two groups: the machine used to build and deploy the system, and the "
     "devices used to run it.")

h("2.1 Build and deployment machine", 2)
para("Needed once per release, by whoever publishes the build. Not needed to use the system.")
table(["Component","Minimum","Recommended","Why"],
[["Processor","Dual-core x86-64 or Apple Silicon, 2.0 GHz","Quad-core, 2.5 GHz or faster","A production build compiles seventeen routes; on a dual-core machine this takes noticeably longer"],
 ["Memory","4 GB RAM","8 GB RAM","Node holds the whole module graph in memory during the build. 4 GB completes but leaves little headroom"],
 ["Storage","3 GB free","5 GB free","node_modules is roughly 700 MB and the build cache grows to several gigabytes over repeated builds"],
 ["Display","1280 x 720","1920 x 1080","The desktop layout is designed at 1440 px and above"],
 ["Network","Any broadband connection","10 Mbps or better","Dependency installation downloads roughly 700 MB the first time"]],
 [1.1,1.6,1.6,2.1])

h("2.2 End-user devices", 2)
para("The interface is built for three widths and was tested at each. No installation is required on any of them.")
table(["Device class","Screen width","Layout served","Minimum specification"],
[["Desktop or laptop","1024 px and above","Full 196 px sidebar, multi-column pages","Any machine from roughly 2016 onward running a current browser; 4 GB RAM"],
 ["Tablet","768 to 1023 px","60 px icon rail, condensed tables","iPad from 2018 onward, or an equivalent Android tablet"],
 ["Phone","Below 768 px","Bottom tab bar, single-column, filters in a bottom sheet","Any phone running a browser released in the last three years"]],
 [1.3,1.3,1.9,1.9])
para("A touch screen is supported but not required; every action is reachable with a keyboard and pointer. "
     "No printer is required, although the Reports page produces a print-ready PDF through the browser's own "
     "print dialogue.", italic=True)

h("2.3 Server and network hardware", 2)
table(["Item","Requirement"],
[["Application server","None. The front end is static and served from a CDN"],
 ["Database server","None. Cloud Firestore is a managed service"],
 ["Storage volume","None. Photographs are stored as compressed data inside Firestore documents, capped at 700 KB each"],
 ["Fixed IP or DNS","Only a domain name, if a custom one is wanted. The hosting provider supplies a working address without it"],
 ["Firewall change","None inbound. Client devices need outbound HTTPS on port 443 to the domain, firebaseapp.com and googleapis.com"]],
 [1.8,4.8])
doc.add_page_break()

# ============================ 3. SOFTWARE ============================
h("3. Software requirements", 1)

h("3.1 Build environment", 2)
table(["Software","Version used","Minimum","Purpose"],
[["Node.js","22.23.1","20.0 or newer","Runs the compiler and the tooling"],
 ["pnpm","11.18.0","9.0 or newer","Installs dependencies. npm also works"],
 ["Git","Any current version","2.30","Retrieving the source"],
 ["Firebase CLI","13.35.1","13.0","Deploying the security rules and running the emulator"],
 ["Operating system","Fedora Linux","Linux, macOS 12+, or Windows 10+ with WSL2","Any of the three is supported"]],
 [1.4,1.4,1.7,2.0])

h("3.2 Application dependencies", 2)
para("Installed automatically by the install command. Versions are pinned in pnpm-lock.yaml so every machine "
     "resolves the same tree.")
table(["Package","Version","What it provides"],
[["next","16.3.4","Framework, App Router and the build pipeline"],
 ["react / react-dom","19.2.8","The user interface library"],
 ["firebase","12.19.0","Authentication and Firestore client SDK"],
 ["@base-ui/react","1.8.0","Accessible dialog, select and sheet primitives used by shadcn/ui"],
 ["recharts","3.10.1","Sensor reading charts and the dashboard load profile"],
 ["motion","13.4.1","Card movement between board columns, and exit animations"],
 ["lucide-react","1.43.0","Icon set"],
 ["sonner","2.0.8","Toast notifications"],
 ["next-themes","0.4.6","Light, dark and system theme switching"],
 ["tailwindcss","4.x","Styling, via the design token sheet in globals.css"],
 ["typescript","5.x","Static typing across the whole source tree"],
 ["biome","2.x","Linting and formatting"],
 ["vitest","5.0.1","Unit tests, 272 of them over the pure rules in lib/"]],
 [1.6,1.1,3.8])

h("3.3 End-user software", 2)
table(["Requirement","Detail"],
[["Web browser","Chrome, Edge, Firefox or Safari, any version from the last two years. The build targets browsers supporting ES2022 and CSS nesting"],
 ["JavaScript","Must be enabled. The application will not function without it"],
 ["Cookies","Not used. The session is held in sessionStorage and ends when the tab closes"],
 ["Screen reader","Optional. Interactive controls carry ARIA labelling and every status is conveyed by icon and word as well as colour"],
 ["Additional software","None. There is nothing to install on a user device"]],
 [1.6,4.9])

h("3.4 Cloud services", 2)
table(["Service","Plan","What it is used for","Free-tier limit"],
[["Firebase Authentication","Spark (free)","Email and password sign-in for all staff accounts","Unlimited for email and password"],
 ["Cloud Firestore","Spark (free)","Eleven collections of live application data","1 GiB stored, 50,000 reads and 20,000 writes per day"],
 ["Hosting (Vercel or Firebase)","Hobby / Spark","Serving the compiled front end","100 GB bandwidth per month"]],
 [1.8,1.1,2.2,1.6])
para("Note on capacity. Every page holds live subscriptions, so a read is charged per document delivered. With "
     "three buildings and around thirty concurrent users the estimated daily read count stays comfortably inside "
     "the free tier. A larger estate would need the Blaze pay-as-you-go plan.", italic=True)
doc.add_page_break()


# ============================ 4. INSTALLATION ============================
h("4. Installation procedure", 1)
para("Roughly fifteen minutes on a machine that already has Node and Git. Every command is run from a terminal in "
     "the project folder unless stated otherwise.")

h("Step 1 — Obtain the source", 2)
code("git clone <repository-url>\ncd smart-campus-management")

h("Step 2 — Install the runtime", 2)
para("Confirm Node is version 20 or newer, then install pnpm if it is not present.")
code("node -v          # must print v20.x or higher\nnpm install -g pnpm\npnpm -v")

h("Step 3 — Install dependencies", 2)
para("Downloads roughly 700 MB the first time. Later runs are served from the pnpm store and take seconds.")
code("pnpm install")

h("Step 4 — Create the Firebase project", 2)
steps(["Open console.firebase.google.com and choose Add project. Any name is acceptable; Google Analytics can be turned off.",
       "Open Build, then Authentication, then Get started. Enable the Email/Password provider and save.",
       "Open Build, then Firestore Database, then Create database. Choose the region closest to the users. Start in production mode; the rules are deployed in Step 7.",
       "Open Project settings, then General, then Your apps. Click the web icon, register an app with any nickname, and leave the firebaseConfig block on screen for the next step."])

h("Step 5 — Supply the project credentials", 2)
para("Copy the example file and fill in the six values from the firebaseConfig block.")
code("cp .env.example .env.local")
table(["Key in .env.local","Value from firebaseConfig"],
[["NEXT_PUBLIC_FIREBASE_API_KEY","apiKey"],
 ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN","authDomain"],
 ["NEXT_PUBLIC_FIREBASE_PROJECT_ID","projectId"],
 ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET","storageBucket"],
 ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID","messagingSenderId"],
 ["NEXT_PUBLIC_FIREBASE_APP_ID","appId"]],
 [3.2,3.2])
para("These six values are not secret. They identify which project the browser should talk to and are present in "
     "the compiled JavaScript by design. What protects the data is the security rules deployed in Step 7, not the "
     "secrecy of these keys.", italic=True)

h("Step 6 — Create the accounts and the starting estate", 2)
para("This writes the three role accounts and the estate they manage. It must run before the security rules are "
     "deployed, because the first user profile cannot be written through those rules.")
code("INIT_PASSWORD='Password!2026' pnpm init:project")
para("It creates three buildings, nineteen rooms, sixteen equipment types, twenty-eight equipment units, five "
     "sensor types and twenty-nine sensors. It deliberately creates no maintenance requests, log entries or "
     "reports, so the record starts clean and fills as the system is used.")
table(["Account","Role","Scope"],
[["daw.htun@university.edu","CEO / Super Admin","The whole estate"],
 ["elysha@university.edu","Admin Manager","The whole estate, except buildings and rooms"],
 ["hnin.nwe@university.edu","Office Staff","Building 216 only"]],
 [2.4,2.0,2.2])

h("Step 7 — Deploy the security rules", 2)
para("Until this runs, the database is open to anyone holding the configuration values above. This step is what "
     "makes the role restrictions real rather than cosmetic.")
code("firebase login\nfirebase use --add        # select the project created in Step 4\npnpm rules:deploy")

h("Step 8 — Verify locally", 2)
code("pnpm dev")
para("Open http://localhost:3000 and sign in as the CEO account. Check that the dashboard draws, the sidebar shows "
     "eight items, and the estate table lists the three buildings.")

h("Step 9 — Build for production", 2)
para("Verify the build by its exit code. The message about successful compilation is printed before the prerender "
     "step, which can still fail after it.")
code("pnpm build\necho $?          # must print 0")

h("Step 10 — Publish", 2)
para("Either hosting route serves the same compiled output.")
table(["Option","Commands","Notes"],
[["Vercel","npm i -g vercel, then vercel --prod","Detects Next.js automatically. The six environment variables must be added in the Vercel dashboard"],
 ["Firebase Hosting","firebase init hosting, then firebase deploy --only hosting","Keeps hosting and database in one console"]],
 [1.2,2.8,2.4])

h("Step 11 — Post-deployment check", 2)
steps(["Sign in as each of the three accounts in turn.",
       "Confirm Office Staff sees five sidebar items and no building selector.",
       "Confirm Log Book, Reports and Administration each show a refusal for Office Staff.",
       "Raise one test request and confirm it appears in Firestore.",
       "Delete the test request and run the reset command if a clean start is wanted."])
doc.add_page_break()

# ============================ 5. CONFIGURATION ============================
h("5. Configuration", 1)

h("5.1 Environment variables", 2)
para("All configuration is supplied through environment variables. There is no configuration file to edit inside "
     "the source tree.")
table(["Variable","Required","Default","Effect"],
[["NEXT_PUBLIC_FIREBASE_API_KEY","Yes","none","Identifies the Firebase project"],
 ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN","Yes","none","Domain used for the sign-in flow"],
 ["NEXT_PUBLIC_FIREBASE_PROJECT_ID","Yes","none","Which Firestore database to read"],
 ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET","Yes","none","Required by the SDK even though no bucket is used"],
 ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID","Yes","none","Required by the SDK"],
 ["NEXT_PUBLIC_FIREBASE_APP_ID","Yes","none","Identifies this web app within the project"],
 ["NEXT_PUBLIC_FIREBASE_EMULATORS","No","0","Set to 1 to talk to the local emulator suite instead of the live project"],
 ["INIT_PASSWORD","No","SmartPassword!","Shared password given to the three accounts created by the setup script"]],
 [2.5,0.8,1.1,2.2])
para("The application fails loudly at load if the API key is missing, rather than surfacing the problem much later "
     "as a confusing sign-in error:")
code('if (!useEmulators && !firebaseConfig.apiKey) {\n'
     '  throw new Error(\n'
     '    "Firebase is not configured. Copy .env.example to .env.local and fill in the " +\n'
     '      "NEXT_PUBLIC_FIREBASE_* values, or set NEXT_PUBLIC_FIREBASE_EMULATORS=1 to " +\n'
     '      "run against the local emulator suite.",\n'
     '  );\n}\n\n// src/lib/firebase.ts')

h("5.2 Database structure", 2)
para("Eleven collections, each behind a live subscription. Firestore is schemaless, so the shape below is enforced "
     "by TypeScript in src/lib/types.ts and by the security rules, not by the database itself.")
table(["Collection","Document id","Holds","Written by"],
[["users","Firebase uid","Name, email, role, assigned building, status","Administration"],
 ["buildings","Human id, e.g. b216","Name, site code, address, floors, description","Administration (CEO only)"],
 ["rooms","Human id, e.g. r-216-302","Name, floor, room type, parent building","Administration (CEO only)"],
 ["equipmentTypes","Slug, e.g. air-conditioner","Label and archive state","Equipment, type registry"],
 ["equipmentUnits","Asset tag, e.g. EQ-216-01","Type, room, condition, install date, service interval","Equipment"],
 ["equipmentHistory","Auto id","One row per thing that happened to a unit","Equipment, batched with the change"],
 ["sensorTypes","Slug, e.g. fire-alarm","Statuses, actions, measurement bands, room-type exceptions","Sensors, type registry"],
 ["sensors","Device id, e.g. FD-216-14","Type, room, current status, last reported time","Sensors"],
 ["requests","Request number, e.g. REQ-4192","Issue, priority, status, submitter, decline reason","Requests"],
 ["logBook","Auto id","Append-only audit trail of every action","Every page"],
 ["reports","Report id","A whole generated report, snapshotted at generation","Reports"]],
 [1.5,1.5,2.4,1.4])
para("Two conventions are worth noting. The human identifier is the document id wherever one exists, because every "
     "cross-reference already holds that string. And logBook and equipmentHistory are append-only: an entry is "
     "never edited once written, because an audit trail that can be rewritten is not one.")

h("5.3 Indexes", 2)
para("firestore.indexes.json is deliberately empty. Every query is single-collection and ordered on one field, "
     "which Firestore serves from its automatic single-field indexes. Adding a where clause alongside an orderBy "
     "on a different field would require a composite index and a redeployment.")
code('// src/lib/firestore-store.ts\n'
     'export const COLLECTIONS = {\n'
     '  users: "users",\n'
     '  logBook: "logBook",\n'
     '  buildings: "buildings",\n'
     '  rooms: "rooms",\n'
     '  sensorTypes: "sensorTypes",\n'
     '  sensors: "sensors",\n'
     '  equipmentUnits: "equipmentUnits",\n'
     '  equipmentTypes: "equipmentTypes",\n'
     '  equipmentHistory: "equipmentHistory",\n'
     '  requests: "requests",\n'
     '  reports: "reports",\n'
     '} as const;')

h("5.4 Roles and authorisation", 2)
para("Three roles, ranked. Permissions are decided by rank rather than by comparing role names, so a new role "
     "slots in without rewriting every check.")
table(["Role","Rank","May do"],
[["CEO / Super Admin","1","Everything, including buildings, rooms and all accounts"],
 ["Admin Manager","2","Everything except buildings and rooms; may manage Office Staff accounts only"],
 ["Office Staff","3","Their own building. Raise, withdraw and verify requests; act on equipment except decommissioning. Sensors are read-only. No Log Book, Reports or Administration"]],
 [1.6,0.7,4.3])
code('// src/lib/permissions.ts\n'
     'export function canAct(role: UserRole): boolean {\n'
     '  return role !== "office-staff";\n'
     '}\n\n'
     'export function canManageEstate(role: UserRole): boolean {\n'
     '  return roleRank(role) <= 1;   // CEO only\n'
     '}')
para("Two layers say the same thing. src/lib/permissions.ts decides what to draw on screen; firestore.rules decides "
     "what the database will actually allow. When one changes, the other must change in the same commit, or the "
     "padlocks become decoration.")

h("5.5 Theme and appearance", 2)
para("Light, dark and system themes are switched on the Settings page and remembered per signed-in user. Colours "
     "are CSS variables declared in src/app/globals.css; no colour is written as a literal anywhere in the source.")
doc.add_page_break()

# ============================ 6. USER DOCUMENTATION ============================
h("6. User documentation", 1)
para("A step-by-step guide to each page, with the screen as the user sees it and the source file that produces it. "
     "Every page lives in one file, with its sub-components beside it.")

h("6.1 Signing in", 2)
steps(["Open the application address in a browser.",
       "Enter the university email address and password.",
       "Select Sign in."])
para("The session lasts until the browser tab is closed. It is held in sessionStorage rather than a cookie, so "
     "closing the tab signs you out and two tabs do not share a session. If the password is wrong the message is "
     "deliberately vague, so the form cannot be used to discover which addresses exist.")
figure("R02-signed-out-login.jpg", "Figure 1 — the sign-in screen")
code("// src/app/login/page.tsx — the sign-in form\n"
     "// src/lib/auth.tsx   — useAuth(), the only module importing firebase/auth")

h("6.2 Dashboard", 2)
para("The opening screen. It answers what needs attention right now.")
steps(["Choose a building from the selector at the top left to narrow every figure on the page. Office Staff do not see this control; they are scoped to their own building.",
       "Read the equipment tiles for running, under maintenance and faulty counts.",
       "Use Requests needing a decision to advance a request one step without leaving the page.",
       "Watch Live alerts and the Log Book rail on the right, both of which update without a refresh."])
figure("T001-dashboard-load.jpg", "Figure 2 — the dashboard, whole estate")
code("// src/app/(app)/dashboard/page.tsx")

h("6.3 Equipment register", 2)
para("Every asset the estate owns, in a table or on a condition board.")
steps(["Switch between Register and Condition board with the control beside the search box.",
       "Narrow the list by search text, building, or equipment type.",
       "Turn on Show decommissioned to include retired units, which are hidden by default.",
       "Select any row to open its detail drawer.",
       "In the drawer, use one of the six actions: Mark faulty, Return to service, Under maintenance, Record a service, Move unit, or Decommission.",
       "Decommissioning and deleting both demand a written reason before they will proceed."])
figure("T004-equipment-register-view.jpg", "Figure 3 — the equipment register")
figure("T014-unit-detail-drawer.jpg", "Figure 4 — a unit's detail drawer, with its history and six actions")
code("// src/app/(app)/equipment/page.tsx\n"
     "// src/lib/equipment-store.ts — every write batches its history row with the change")

h("6.4 Sensors", 2)
para("Two jobs on one page: watching the estate, and setting the limits it is watched against.")
steps(["The Monitoring tab shows comfort figures, a floor-by-floor climate grid, and each building's devices.",
       "Filter to All devices, Alarms only, or Offline.",
       "Select a reading card's chevron to reveal its device id, axes and history.",
       "The Thresholds tab lists each measuring type's bands, with any room types that disagree shown beneath.",
       "Edit a band through Manage types. A server room and a lecture hall can hold different limits for the same measurement."])
figure("S01-sensors-monitoring.jpg", "Figure 5 — Monitoring")
figure("S03-sensors-thresholds.jpg", "Figure 6 — Thresholds, with room-type exceptions")
code("// src/app/(app)/sensors/page.tsx\n"
     "// src/lib/sensor-readings.ts — where a number becomes a status\n"
     "// src/lib/climate.ts         — the estate rolled up to one row per room")

h("6.5 Maintenance requests", 2)
para("The five-step approval workflow, as a board or a table.")
steps(["Select New request. Choose the building, room and equipment unit, describe the fault, and set a priority.",
       "The request enters the Requested column.",
       "An Admin Manager or the CEO approves it, or sends it back with a written reason.",
       "Approved work moves through In progress and Resolved to Completed.",
       "The person who raised a request may withdraw it while it is still unapproved, and may flag resolved work as done."])
figure("Q01-requests-board.jpg", "Figure 7 — the five-column board")
figure("Q02-new-request-drawer.jpg", "Figure 8 — raising a request")
code("// src/app/(app)/requests/page.tsx\n"
     "// moveRequest(id, \"next\" | \"prev\") in src/lib/app-state.tsx walks the five steps")

h("6.6 Historical records", 2)
para("The significant subset of the audit trail, reachable by every role including Office Staff.")
steps(["Switch between Important and All activity.",
       "Narrow by date range, building or record type.",
       "Any entry that required a written reason shows that reason beneath the row.",
       "Export the filtered set to CSV; the file matches what is on screen."])
figure("P01-records.jpg", "Figure 9 — historical records, reasons shown beneath each row")
code("// src/app/(app)/records/page.tsx\n"
     "// src/lib/records.ts — isSignificant() decides what Important shows")

h("6.7 Log Book", 2)
para("The live feed of everything the system writes down. Admin Manager and CEO only.")
steps(["Entries arrive as they happen; use Pause to hold the feed while reading.",
       "Actions only is on by default and hides automated sensor readings, which would otherwise be most of the feed.",
       "Filter by source or by a date and time range."])
figure("P02-logbook.jpg", "Figure 10 — the Log Book, automated readings hidden")
code("// src/app/(app)/logbook/page.tsx\n"
     "// isRoutineReading() in src/lib/records.ts separates estate chatter from human action")

h("6.8 Reports", 2)
para("Generated performance, reliability and cost reports, kept as filed documents.")
steps(["Select Generate report, choose a kind, a scope and a date range.",
       "The figures are snapshotted at generation and never recomputed, so a filed report always reads the same.",
       "Open a report to read it, or export it straight to PDF or CSV."])
figure("P03-reports.jpg", "Figure 11 — the report library")
code("// src/app/(app)/reports/page.tsx\n"
     "// src/lib/reporting.ts — buildReport(kind, scope), pure and unit-tested")

h("6.9 Administration", 2)
para("Two tabs behind two different permissions. Buildings belongs to the CEO; User Accounts is shared with the "
     "Admin Manager.")
steps(["Buildings: add or edit a building, upload a photograph, and manage its rooms. Deleting a building demands a written reason and takes its rooms with it.",
       "User Accounts: create an account, change a role, or suspend and restore access.",
       "An account is never deleted, only suspended. A suspended person is signed out on their next action.",
       "Nobody can edit or suspend their own account; those controls are padlocked on your own row."])
figure("P04-admin-accounts.jpg", "Figure 12 — user accounts, with the signed-in user's own row padlocked")
code("// src/app/(app)/admin/page.tsx\n"
     "// canEditUser(actor, target) limits an Admin Manager to Office Staff rows")

h("6.10 Settings", 2)
steps(["Your account: change your display name and telephone number.",
       "Appearance: choose light, dark or system.",
       "Password and sessions: change your password."])
code("// src/app/(app)/settings/page.tsx")

h("6.11 A note on restricted controls", 2)
para("A control a role may not use is never hidden. It stays on screen behind a padlock, and the padlock explains "
     "itself when hovered. A restriction that is visible teaches; one that is hidden simply confuses.")
doc.add_page_break()

# ============================ 7. MAINTENANCE ============================
h("7. Maintenance considerations", 1)

h("7.1 Routine tasks", 2)
table(["Task","Frequency","How"],
[["Review Firestore usage against the free tier","Monthly","Firebase console, Usage tab. Watch the daily read count in particular"],
 ["Apply dependency security updates","Monthly","pnpm outdated, then pnpm update. Run the test suite afterwards"],
 ["Review suspended accounts","Each term","Administration, User Accounts"],
 ["Export the Log Book for the records","Each term","Historical Records, Export CSV"],
 ["Verify a restore from backup","Twice yearly","Restore an export into a scratch project and sign in"]],
 [2.6,1.1,2.9])

h("7.2 Backup and recovery", 2)
para("Cloud Firestore on the free plan has no scheduled export. Two practical options:")
bullets(["Manual export from the Firebase console before any significant change, which is enough for a project of this size.",
         "Scheduled daily exports to Cloud Storage, which requires the Blaze pay-as-you-go plan."])
para("The seed script is itself a recovery route for the estate structure. It rewrites buildings, rooms, equipment "
     "and sensors to a known state, and leaves anything created through the application untouched:")
code("pnpm init:project --dry-run     # show what it would change\n"
     "pnpm init:project --reset       # clear every document, then rewrite\n"
     "pnpm init:project --reset-auth  # also delete the sign-in accounts")

h("7.3 Monitoring", 2)
table(["What to watch","Where","Why it matters"],
[["Daily reads and writes","Firebase console, Usage","Live subscriptions charge per document. Exceeding the free tier stops the application"],
 ["Authentication failures","Firebase console, Authentication","A spike suggests either a locked-out user or an attempt to guess passwords"],
 ["Rules denials","Firebase console, Firestore, Rules monitoring","A denial that surprises you means the two permission layers have drifted apart"],
 ["Build status","The hosting provider's dashboard","A failed deployment leaves the previous version live, which is safe but stale"]],
 [1.7,1.8,3.1])

h("7.4 Known constraints", 2)
table(["Constraint","Consequence","Mitigation"],
[["No server-side rendering of protected pages","The route guard is a convenience, not security","Authorisation lives entirely in firestore.rules"],
 ["Photographs stored inside documents","A Firestore document is capped at 1 MiB","Images are downscaled to 640 px and refused above 700 KB"],
 ["No admin SDK in the project","Accounts cannot be deleted programmatically by another user","Accounts are suspended rather than deleted; --reset-auth deletes only accounts whose password is known"],
 ["The first user profile cannot be written under the security rules","A fresh project must be seeded before rules are deployed","Documented as Step 6 before Step 7 in the installation procedure"],
 ["Free-tier daily read limit","A busy day could exhaust it","Upgrade to Blaze, or reduce subscription scope"]],
 [2.0,2.3,2.3])

h("7.5 Extending the system", 2)
para("Three extension points were designed in and need no schema migration:")
bullets(["Equipment and sensor types are data, not code. A new kind of asset or device is added through the type registry in the interface.",
         "Sensor thresholds, including per-room-type exceptions, are edited in the interface rather than in a deployment.",
         "Adding a building or a room in Administration reaches every building filter in the application at once."])
para("Changes that do require a developer: adding a fourth role, adding a field to an existing document type, or "
     "adding a query that filters and sorts on different fields, which would need a composite index.")

h("7.6 Handover checklist", 2)
steps(["Transfer ownership of the Firebase project to the incoming maintainer's Google account.",
       "Transfer or recreate the hosting account, and re-enter the six environment variables there.",
       "Hand over the repository, including the .env.example file but never .env.local.",
       "Confirm the incoming maintainer can sign in, run pnpm dev, and deploy the rules.",
       "Walk through one full request lifecycle together, from raising to completion."])

doc.save("docs/deployment/Deployment-Document.docx")
print("saved")
