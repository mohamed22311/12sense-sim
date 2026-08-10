# Twelve Senses — Demo Simulator Design

**Status:** approved design, ready for implementation planning
**Date:** 2026-08-09
**Repo:** `TwelveSense-TT-SimData`, in place under `scene-3d/`
**Supersedes:** the existing single-floor factory scene in `scene-3d/` (evolved, not replaced)

---

## 1. Purpose

Build a complete, self-contained 3D simulation of a Twelve Senses deployment that can be
demonstrated to a client with **no real phones, no real workers, and no real machines** — while
every alert, response and analytic it produces is genuinely written to and read from the deployed
production server.

The simulation is not a mock. It is a **fleet of virtual phones**: each simulated worker holds a
real account, a real JWT and a real WebSocket, and runs the Thalamus decision logic verbatim. When
a machine raises an alert, the server broadcasts it to sixty clients, and sixty independent copies
of `proximity.ts` and `modality.ts` decide — separately — whether that worker is alerted and
through which channel.

**The test this design is built to pass:** a sceptical engineer in the room should be unable to
find a place where the demo behaves differently from the product.

### 1.1 Non-goals

- **The dispatcher web app is out of scope.** No admin SPA is built here. The server's
  `GET /events`, `GET /events/{id}`, `GET /analytics/summary` and `/team` remain without a consumer.
- **No in-scene backend inspector.** The integration works silently; there is no traffic panel and
  no in-world admin monitor. The existing `AdminStation` mesh stays as scenery only — it is no
  longer clickable and opens nothing.
- **No FCM / background push _from the simulator_.** Simulated phones never call `POST /devices`,
  so their delivery is WebSocket-only. **Amended 2026-08-10:** the optional controlled worker (§12)
  is a real Thalamus install on a real handset, so for that one worker FCM, device registration and
  background delivery are all exercised — by the app, not by the simulator.
- **No offline-outbox demonstration.** The write-ahead queue exists in the app; reproducing a
  coverage drop is explicitly not one of the demo beats we are building for.
- **No Salesforce.** Alerts originate from `POST /simulations/events` only.

---

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Backend | The deployed server: `https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws` |
| CORS | Bundled dev proxy now; ticket raised for `CORSMiddleware` so it can be hosted later |
| Reset | A fresh throwaway company per demo session; server-side purge when that endpoint exists |
| Dispatcher | Out of scope |
| Worker count | Configurable, **default 60** |
| Floors | Six, shown as a dollhouse cutaway with one active (lit, detailed) floor |
| Visual approach | Richer procedural — no GLTF, no external assets |
| Worker behaviour | Role-filtered job queue with grid A\* pathing, including cross-floor travel |
| Repo layout | Rewrite in place under `scene-3d/`, current state committed first as a restore point |
| Decision logic | Thalamus's pure modules **vendored verbatim** |
| Modality conflict | The mobile app wins — haptic is never suppressed |
| Vitals model | Physiology driven by each worker's current job |
| Demo timing | Trailing-series backfill; real thresholds unmodified |
| Watch / phone UI | Rebuilt from the real Thalamus screens |
| Sites | One site per demo session (factory **or** construction) |
| Startup | Setup screen with an explicit Start button |
| Machine panel | Preset incidents plus full manual control |
| Deployment | Local now; hosted once CORS lands |
| Performance | Adaptive quality tier, auto-detected, manually overridable |
| Demo beats | Out-of-range gating · snooze → server re-alert · two-worker ack race |
| Vitals panel | Exactly the inputs the app's decision modules consume |
| **Controlled worker** (added 2026-08-10) | Optional. One roster slot is a **real account on a real phone**, playable in the scene — see §12 |
| Controlled worker's decisions | **The physical device owns them.** The simulator runs no virtual phone for that slot |
| Making his phone genuinely in range | **Moving frame**: the site is anchored so the avatar always sits at the phone's real coordinates |
| His floor | The app cannot be set remotely; the sim prompts and shows a mismatch banner |
| His enrolment | A **profile enrolment code** shown as a QR; the sim polls `GET /team/{id}` for `pending → active` |
| Observing him | One **admin WebSocket**, consuming the `response_update` dashboard feed (S3-BE5) |

---

## 3. Known constraints in the platform

These were verified against the running deployment on 2026-08-09 and shape the design.

### 3.1 CORS is not enabled (blocking)

```
OPTIONS /api/v1/auth/login   Origin: http://localhost:5173
→ 405 Method Not Allowed, no Access-Control-Allow-Origin
```

`grep -rn "CORS" app/` in the server repo returns nothing. React Native does not enforce CORS, so
the phone never surfaced this. **Every REST call from a browser is blocked.**

WebSockets are exempt — browsers apply no CORS preflight to `wss://` — so the live channel works
today over TLS.

**Mitigation:** the simulator ships with a dev-server proxy (`vite.config.ts` `server.proxy`)
forwarding `/api` to the deployment. A server-side ticket has been raised; when `CORSMiddleware`
lands, the proxy becomes redundant and the app can be hosted.

### 3.2 There are no delete endpoints

The live OpenAPI exposes DELETE only on `/enrollment-codes/{code_id}` and `/devices`. Nothing can
remove a company, a user or an event.

**Mitigation:** reset provisions a **new** company each time rather than clearing an old one. A
purge-endpoint ticket has been raised; when it exists, reset calls it and reuses one tenant.

### 3.3 Registration constraints

From `app/schemas/auth.py`:

- `username` — 3–150 chars, unique **platform-wide**
- `email` — `EmailStr`, unique platform-wide
- `password` — 8–72 bytes (bcrypt truncates past 72)
- `first_name` / `last_name` — required, non-empty (S3-BE14)
- `code` — required; resolves the company

Platform-wide uniqueness is why every generated identity carries the session slug.

**Open risk, resolved in Phase 1 task 1:** if the deployed build has email deliverability checking
enabled, a synthetic domain may 422. This is proven with a single throwaway registration **before**
any provisioning code is written. If it fails, identities fall back to a domain that resolves.

---

## 4. Architecture

### 4.1 Layers

The controlling rule: **the phone never reads the 3D scene, and the scene never knows the backend
exists.** Only `runtime/` touches both.

```
  scene/          R3F rendering, animation, navmesh, camera, materials
      │           (knows nothing of HTTP, JWTs or events)
      ▼  position · floor · activity
  runtime/        WorkerRuntime — one per worker; owns an agent and a phone
      │
      ▼
  phone/          VirtualPhone: vendored decision modules, vitals buffer, response outbox
      │
      ▼
  net/            apiClient (REST) · wsClient (WebSocket) · provisioning · session
```

Directory layout under `scene-3d/src/`:

```
net/         apiClient.ts  wsClient.ts  provisioning.ts  session.ts  config.ts
phone/       VirtualPhone.ts  vitalsBuffer.ts  physiology.ts  outbox.ts
phone/vendor/ proximity.ts  modality.ts  risk.ts  vitals.ts  alerting.ts
              alertDedup.ts  eventLifecycle.ts  ambientContext.ts  baseline.ts
runtime/     WorkerRuntime.ts  fleet.ts  scheduler.ts  geo.ts
sim/         jobs.ts  roles.ts  navmesh.ts  pathing.ts  agent.ts  animation.ts
scene/       Building.tsx  Floor.tsx  Worker.tsx  Machine.tsx  Lift.tsx  Stairs.tsx …
sites/       factory/  construction/     (layout data, asset defs, job pools)
ui/          SetupScreen.tsx  MachinePanel.tsx  WatchView.tsx  PhoneOverlay.tsx
             VitalsPanel.tsx  QualitySettings.tsx
quality/     detect.ts  tiers.ts
```

### 4.2 The virtual phone fleet

**Sixty independent phone instances, each with its own WebSocket.** Considered and rejected:

- *One socket with internal fan-out* — cheaper, but the server would see one client, `seeded` and
  `tracked` would be fiction, and sixty JWTs are needed for the response POSTs regardless. It saves
  the sockets and nothing else.
- *Web Workers, N phones per thread* — better isolation, and where this goes if profiling demands
  it. Not the starting point: `risk.ts` is array scans over ~60 samples, and sixty of those on a
  stagger is negligible beside rendering. The tick scheduler is written so this move stays
  contained.

Each `VirtualPhone` owns:

- its worker's `access_token` / `refresh_token`, and the refresh-on-401 path
- a live `wss://…/ws?token=` connection, answering `ping` with `pong`
- a rolling **60-minute vitals buffer** (HR series, step buckets, latest SpO₂)
- the vendored decision modules and their state (the alert latch, the seen-event dedup set)
- an **outbox** that POSTs responses and health alerts with `client_event_id` idempotency

### 4.3 Vendoring the decision logic

Thalamus's pure modules are copied **verbatim** into `phone/vendor/`. They are already free of
React, Expo and I/O — they take plain values and return verdicts — so they run unchanged.

Every vendored file carries a header naming its source path and the mobile-repo commit it was taken
from. A `npm run check:vendor` script diffs the copies against a configured checkout of
`TwelveSense-TT-MobileApp` and fails on drift, so divergence is discovered at build time rather
than mid-demo.

Modules vendored: `realtime/proximity.ts`, `context/modality.ts`,
`context/ambientContext.ts`, `health/risk.ts`, `health/vitals.ts`, `health/alerting.ts`,
`health/baseline.ts`, `health/restingBaseline.ts`, `realtime/alertDedup.ts`,
`realtime/eventLifecycle.ts`, `realtime/mapEvent.ts`.

**Deliberately not vendored** — these are I/O shells with Expo dependencies, and the simulator
supplies its own: `healthConnect.ts`, `poller.ts`, `noiseMonitor.ts`, `gps.ts`, `foregroundService.ts`,
`groupAlertGate.ts`, everything under `notifications/`.

### 4.4 Resolving the modality divergence

`12sense-sim/src/logic/routing.ts` and Thalamus's `modality.ts` agree on three rows and disagree on
one:

| motion × noise | old sim | Thalamus (authoritative) |
|---|---|---|
| moving · loud | haptic | haptic |
| moving · quiet | haptic + sound | haptic + sound |
| still · loud | haptic + visual | haptic + visual |
| **still · quiet** | visual + sound (**haptic suppressed**) | **visual + haptic + sound** |

**Thalamus wins.** Haptic is an on-body safety floor and is never suppressed. The old
`logic/routing.ts` is deleted rather than corrected — the vendored `modality.ts` replaces it, so
there is no second table to drift.

Two documentation corrections follow, in the repos that hold them:

- the server design doc's §2 claim that modality *"reuses charter rules proven in
  `12sense-sim/routing.ts`"* is no longer true and should name `modality.ts`;
- `12sense-sim`'s README routing table is superseded by this document.

### 4.5 Geography

Each site declares an anchor coordinate. Scene metres convert to WGS-84:

```
lat = anchor.lat + z / 111_320
lon = anchor.lon + x / (111_320 · cos(lat))
```

Consequences, all of them load-bearing:

- a worker's GPS fix derives from where they are actually standing, refreshed as they walk;
- machines carry genuine `latitude` / `longitude` / `alert_radius_m` / `floor`;
- `decideProximity` runs the real haversine on real numbers, and `distance_m` in every response is
  a true measurement;
- the out-of-range demo beat works because the arithmetic says so.

Floors are labelled `"1"` … `"6"` — plain strings, matching the `Event.floor` contract. A worker's
`FloorProvider` value updates the moment they arrive on a new level.

### 4.6 Time and the poll loop

| | Thalamus | Simulator |
|---|---|---|
| Vitals poll interval | 60 s | ~2 s |
| `enterTicks.danger` | 1 | 1 *(unchanged)* |
| `enterTicks.caution` | 2 | 2 *(unchanged)* |
| `recoveryTicks` | 3 | 3 *(unchanged)* |
| `exertion.sustainedMs` | 3 min | 3 min *(unchanged)* |

**No threshold is altered.** The only change is how often the engine is asked.

Each phone keeps a rolling 60-minute vitals buffer — the `load` rule needs one anyway. When you
change a vital and press Send, the simulator **rewrites the trailing minutes of that buffer** to be
consistent with the new value. `risk.ts` then observes a genuine three-minute sustained run and
returns `danger`, which `enterTicks.danger = 1` raises on the very next tick — about two seconds
later.

The engine is not faked. Only the history it reads is authored, which is what a simulator is for.

Ambient physiology runs continuously from each worker's current job: HR rises while walking,
climbing and carrying, and recovers during rest; steps accumulate with movement; SpO₂ drifts within
a healthy band. Health alerts therefore arise on their own, and the vitals panel is an override
rather than the only source.

### 4.7 Provisioning, session and reset

**Start** (from the setup screen, with a progress bar):

1. `POST /companies/register` — company `demo-<site>-<timestamp>`, plus its first admin.
2. `POST /enrollment-codes` — `{ type: "join", max_uses: null }`.
3. `POST /auth/register` × N — concurrency-limited to 8 in flight.
4. Open N WebSockets, staggered.

Generated identities:

| Field | Pattern |
|---|---|
| `username` | `sim-<session>-w01` |
| `email` | `w01@<session>.sim.twelvesenses.io` |
| `password` | a fixed 12-char demo constant |
| `first_name` / `last_name` | drawn from a name pool, matched to the site |
| `date_of_birth` | seeded per worker — drives `hrMaxForAge`, so ages must vary |

`<session>` is a short timestamp slug, present because uniqueness is platform-wide.

**Reset** closes every socket, discards all tokens and local state, and re-runs provisioning under a
new company. Nothing is deleted server-side until the purge endpoint exists; at that point reset
calls it and reuses a single tenant.

The admin token is held only in memory. A page refresh ends the session — deliberate, so a stray
reload cannot silently create a second company mid-demo.

---

## 5. The sites

Six floors each, in the dollhouse cutaway. The construction site uses a **completion gradient** —
finished at the bottom, open steel and sky at the top — so each floor has a distinct silhouette and
the cutaway reads instantly.

| Floor | Factory | Construction |
|---|---|---|
| F6 | Plant & control room — chillers, switchgear, monitor wall | Top deck — crane mast, edge protection, rebar bundles, open sky |
| F5 | Packaging & QA — packing lines, inspection benches, labelling | Structural frame — exposed columns, beams, metal decking, welding |
| F4 | Process hall — reactor, pressure vessels, pipework | Concrete pour — rebar mats, formwork, pump line, wet slab |
| F3 | Production hall — press line, CNC cells, conveyors | Blockwork — block stacks, mortar silo, internal scaffold |
| F2 | Material prep — hoppers, mixers, silos, drum store | Fit-out — partitions, MEP first fix, ceiling grid |
| F1 | Goods-in / dispatch — loading bays, forklifts, racking | Site entrance — site office, lay-down area, hoist base, fencing |

Three or four alertable assets per floor, each with real coordinates and a floor label. Factory:
`CHILLER-07`, `REACTOR-01`, `PRESS-12`, `PACK-03`, `COMPRESSOR-01`, `FURNACE-03`, … Construction:
`HOIST-01`, `CRANE-01`, `GEN-03`, `WELDER-05`, `PUMP-02`, `MIXER-02`, …

Workers are distributed across floors (≈10 per floor at the default 60) and are free to move
between them.

### 5.1 Dollhouse presentation

The building is an open-fronted stack. The **active** floor is fully lit and fully detailed; the
others dim, lose shadow casting, and simplify their crowds. Clicking a floor — or riding the lift —
changes the active floor. An alert firing on a dim floor still shows its beacon, so you can see
something happen elsewhere and go look.

---

## 6. Worker behaviour

Each worker has a **role** that filters the jobs they accept.

- **Factory:** operator, technician, QA inspector, materials handler, supervisor, cleaner
- **Construction:** steel fixer, concrete crew, scaffolder, welder, banksman, labourer, supervisor

**Job pool:** inspect an asset · operate an asset · fetch material from stores · carry material to a
destination · log at a terminal · meet a colleague and talk · take a break · sweep · walk a
supervision route · travel to another floor.

Each job carries a location, a duration range and an animation. A worker completes one, then draws
the next from the pool their role permits — so cycles never repeat exactly.

**Pathing** is a per-floor uniform grid with A\*, obstacles derived from that floor's static
geometry, and portal nodes at the stairwell and the lift. No third-party library; a few hundred
lines, and it never walks through scenery.

**Cross-floor travel** routes the worker to the stairs or lift, moves them, and resumes the job on
arrival. Their `FloorProvider` value changes on arrival, so the floor gate genuinely re-evaluates —
a worker who has just stepped onto F4 begins qualifying for F4 alerts. The multi-floor story
demonstrates itself rather than being narrated.

---

## 7. Visual design

Procedural throughout — no GLTF, no external assets, everything editable in code.

**Characters** get a real rig: hips, spine, head, arms with elbows, legs with knees. That makes
walking, carrying, kneeling, reaching overhead and crouching to weld distinct poses rather than a
bobbing box. Hard hat with a brim, hi-vis vest with reflective bands, gloves, boots, tool belt.
Build, skin tone, vest colour and gait vary per worker from a seeded hash, so sixty people look
like sixty people.

**Machines** get bevelled housings, recessed panels, gauges, warning decals, cable runs, status
LEDs, and idle motion — fans turning, pistons cycling, steam venting.

**Lighting and post:** the existing multi-light rig (ambient + hemisphere + key/fill/rim +
locals) plus contact shadows, SSAO, and bloom on emissive surfaces.

### 7.1 Adaptive quality

Frame time is sampled over the first few seconds at a fixed camera, and a tier is selected:

| | High | Medium | Low |
|---|---|---|---|
| Shadows | all floors | active floor only | off |
| Post-processing | SSAO + bloom | bloom | off |
| Dim-floor workers | animated | simplified | instanced |
| Machine idle motion | all floors | active floor | active floor |

A manual override is available in settings, so High can be forced for a recording.

---

## 8. Interaction

### 8.1 Machine → raise an alert

Clicking an asset opens a panel offering **preset incidents** — ammonia leak, pressure anomaly,
electrical fault, fire, structural — each pre-filling severity, type, message and radius, with every
field editable underneath. **Fire** issues:

```
POST /api/v1/simulations/events
{ asset_id, asset_label, latitude, longitude, alert_radius_m, floor, zone_id,
  severity, type, message }
→ 201 { event_id, inserted, delivered, pushed, seeded }
```

The server persists it, seeds a `pending` row per active worker, and broadcasts over WebSocket. All
sixty phones receive it and decide independently.

### 8.2 Worker with a live alert → watch and phone

The camera moves to the worker's wrist. The watch reflects that worker's actual `Modality` verdict:
a pulsing ring for haptic, waveform arcs for sound, a screen flash for visual. The phone overlay
carries the Thalamus alert card — asset, message, severity, distance, floor — with **Ack**,
**Snooze**, **Reject** and **"Why this alert?"**, the last showing the real `context_snapshot`:
motion, noise, floor gate, GPS gate, freshness, fallbacks fired.

If that worker was **gated out**, the panel says so and offers no buttons, because their phone never
popped. This is the honest case and it is shown, not hidden.

Audio plays only for the focused worker. Sixty simultaneous tones would be noise.

### 8.3 Worker with no alert → vitals

The panel exposes exactly what the app's decision modules consume:

**Controls:** heart rate · SpO₂ · steps / activity level · ambient noise (dBFS)
**Read-outs:** estimated resting HR · %HRmax · age · floor · GPS fix · per-rule risk breakdown
(exertion, stress, spo2, restingHr, load, data) with each rule's band, score and reason

HRV, skin temperature, stress index and ECG are **absent by design** — `risk.ts` never reads them,
and Samsung Health does not sync them to Health Connect (`docs/research/health-signals.md` §1).

Press **Send** and the trailing buffer is rewritten; the alert appears within seconds on that
worker's watch and phone, carrying the exact sentence the real engine produced. It POSTs to
`/individual-alerts` with the full `decision_trace`, and its lifecycle (`viewed`, `acknowledged`,
`auto_recovered`) POSTs to `/individual-alerts/{id}/events`.

### 8.4 Responses

Every action posts through the real endpoint:

```
POST /api/v1/events/{event_id}/responses
{ client_event_id, action, occurred_at, snoozed_until?, distance_m?, modality, context_snapshot }
```

- Gated-out phones post `ignored_out_of_range` automatically — analytics only, no alert shown.
- Phones that popped post `popped` with their modality and context snapshot.
- **Ack** resolves the event server-side; the server broadcasts `event_resolved`; every other watch
  clears **on the real message**, never a local one. The acking worker then walks to the machine and
  plays a repair sequence, and the asset returns to green.
- **Snooze** posts an absolute `snoozed_until`. No local timer runs. The server fires
  `event_reminder` when it expires and the alert reappears on that one wrist.
- **Reject** is recorded and does not resolve the event.

### 8.5 The three demo beats

1. **Out-of-range gating** — raise an alert on F4; workers on other floors and beyond the radius
   receive the broadcast, decline to pop, and report `ignored_out_of_range`. Opening one of them
   shows the floor gate that suppressed it.
2. **Snooze → server re-alert** — a worker snoozes; the server re-alerts that worker alone at
   `snoozed_until`, with no local timer involved.
3. **Ack race** — two workers ack within milliseconds; one wins, the other receives the 409 and is
   cancelled. The state machine's first-ack-cuts-everyone-off is shown rather than described.

---

## 9. Error handling

| Condition | Behaviour |
|---|---|
| Provisioning fails partway | Setup screen reports which step failed and how many workers registered; Retry resumes from the failed step rather than re-registering everyone |
| A worker's socket drops | Reconnect with the vendored backoff; on reopen, resync via `GET /group-alerts?status=open` and clear anything resolved meanwhile |
| `401` on any REST call | Single transparent refresh and one retry, as the app does; a failed refresh marks that phone `stopped` and surfaces it in the fleet status |
| `409 event_already_resolved` | Recorded as a lost race, not an error; that phone's alert clears |
| Server unreachable at startup | Setup screen blocks with a clear message and a Retry; the scene never loads against a dead backend |
| Server unreachable mid-demo | The scene keeps running; a non-modal banner reports degraded connectivity and the affected worker count |
| Frame rate collapses | The quality tier steps down once, with a toast; it never oscillates |

The controlling principle, matching Constitution V: **a simulator failure must never look like a
product failure.** Anything that goes wrong is labelled as a simulator problem.

---

## 10. Testing

Vitest, already configured in the repo.

- **Vendored modules** — their Thalamus tests are vendored alongside them and must pass unchanged.
  This is the guarantee that the vendored copies really are the app's behaviour.
- **`geo.ts`** — round-trip scene↔WGS-84 conversion, and known distances against `haversineMeters`.
- **Vitals backfill** — a rewritten buffer produces the expected band from the unmodified engine;
  specifically, a danger-level HR raises on the first tick and caution on the second.
- **Provisioning** — identity generation is unique across sessions; concurrency limiting holds;
  partial-failure resume registers only the missing workers.
- **Pathing** — A\* finds a route around obstacles, returns null when genuinely blocked, and
  produces paths that stay inside walkable cells.
- **Job queue** — role filtering never yields a job the role cannot perform; a completed job always
  yields a next job.
- **Fleet integration** *(one test, against a stubbed WS + REST)* — an event reaches 60 phones,
  the expected subset pops, the rest post `ignored_out_of_range`, an ack resolves, and the
  `event_resolved` broadcast clears the others.

Manual verification against the live deployment is a checklist per phase, not an automated suite —
the server is shared and must not be filled with test data by CI.

---

## 11. Build order

Each phase is independently demonstrable.

**Phase 1 — network and phone fleet.** Provisioning, 60 sockets, vendored logic, outbox, geo
mapping, reset. Proven against the live server using the *existing* single-floor scene. Deliberately
first and deliberately ugly: any surprise in the backend integration surfaces in week one, not after
a factory has been built on top of it. **Starts with the email-domain probe (§3.3).**

**Phase 2 — the building and the controlled worker.** Site data model, dollhouse shell, six floors,
navmesh, job queue, roles, worker AI, stairs and lift, cross-floor travel and its floor-gate
consequence, step-writing physiology, and the controlled worker of §13.

**Phase 3 — interaction.** Machine panel with presets, watch view, phone overlay, "Why this alert?",
vitals panel, ack-and-repair sequence, the three demo beats.

**Phase 4 — visual pass.** Character rig, machine detail, lighting, post-processing, adaptive
quality tiers.

**Phase 5 — construction site.** The second site, reusing everything: layout data, asset
definitions, role set and job pool.

Phases 1–4 deliver a complete, demonstrable factory. Phase 5 doubles the settings.

---

## 12. The controlled worker (added 2026-08-10)

Optional, chosen before Start: **one roster slot is a real account, logged into the real Thalamus
app on a real handset, and playable in the scene.** He replaces one of the N workers rather than
adding to them, so the headcount and every dashboard number stay as configured.

### 12.1 The physical device owns his decisions

The simulator runs **no `VirtualPhone`** for that slot. It renders him, moves him, and observes —
it never speaks for him.

This is a constraint, not a preference. Two clients acting as one worker would both post
`received` / `popped` / `ack` for the same `(event, worker)` pair and race each other into the
state machine: one would win the ack and the other would take the 409, the audit log would carry
two arrivals for one device, and `tracked` would count a worker twice. The real device receives
the broadcast, runs its own gate on its own GPS, and reports its own verdict.

### 12.2 The moving frame — how avatar movement reaches a real gate

The problem: the app computes proximity from the phone's **real** GPS. A virtual site anchored at
a fixed coordinate means a phone anywhere else computes itself out of range and stays silent,
which is indistinguishable from a broken integration.

The solution is a substitution in `runtime/geo.ts`. Rather than a fixed anchor, the anchor is
**whatever value places the controlled avatar at the phone's real coordinates**:

```
anchor = phoneRealPosition − offset(avatar.x, avatar.z)
```

A machine 20 m from the avatar in the scene therefore emits a lat/lon 20 m from where the phone
physically is; the phone measures ~20 m and pops. Walk the avatar across the floor and the same
machine emits 60 m away, and the phone genuinely computes itself out of range.

Because this is a **pure translation** of the whole frame, every virtual phone's geometry relative
to every machine is unchanged — the 60-worker fan-out behaves exactly as it does today.

- **The anchor freezes while any event is open.** Otherwise moving the avatar after an alert fires
  would shift the ground under a snooze re-alert's gate.
- With no controlled worker enrolled, the anchor is the fixed default and nothing changes.
- The phone's real coordinates come from the browser's geolocation (localhost is a secure origin)
  with a manual override, so a demo without a fix still works.

### 12.3 Floor: prompted, never faked

The app's `FloorProvider` is a floor the worker selects at shift start. There is no path for the
server or the simulator to set it, and inventing one by emitting a `floor` the phone will always
match would move the decision back into the simulator — the exact thing this project exists not to
do.

So the sim displays the avatar's floor, prompts you to match it in the app, and shows a live
mismatch banner when they differ. The gate stays entirely real, and a deliberate mismatch becomes
a demo beat: *he is on 2, the alert is on 4, watch it not reach him.*

### 12.4 Enrolment via the product's own profile-code path

`POST /enrollment-codes` with `type: "profile"` pre-creates a `pending` worker and returns its
`assigned_user_id`. The setup screen renders that code as a QR; you enter it in Thalamus and
choose your own password, claiming the pre-created profile.

Two things follow for free: the sim knows his `user_id` **before** the phone ever connects, and it
detects enrolment by polling `GET /team/{user_id}` until `status` flips `pending → active` — so
the screen can say "phone connected" at the moment it truly is.

### 12.5 Observing him

The sim opens **one admin WebSocket** alongside the worker sockets. The server routes an admin
token to a dashboard feed carrying `response_update` for every worker action (S3-BE5, a feature
with no consumer until now), so his ack, snooze or reject arrives live and can drive his animation.
`event_resolved` alone would only reveal the ack.

### 12.6 On screen

A billboarded chevron above his head with his name beneath, bobbing, plus a ground ring — and the
only avatar drawn that way. WASD with a following camera, plus click-to-move, both constrained to
the same navmesh the AI workers use. A compact HUD carries his floor, his phone's connection
state, and the floor-mismatch prompt.

### 12.7 Reset

A reset purges the tenant, which deletes every worker including his, so the phone must re-enrol.
That is accepted: the QR makes it a ~20-second step, and it keeps reset genuinely clean rather
than preserving a special case.

## 13. Open items owned elsewhere

Neither blocks Phases 1–4.

1. **Server: enable CORS.** Required before the simulator can be hosted at a URL. Until then the
   bundled dev proxy covers local demos.
2. **Server: demo tenant purge.** Required to stop throwaway companies accumulating. Until then
   reset creates a new company each session, which works.
