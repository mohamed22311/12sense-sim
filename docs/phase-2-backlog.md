# Carried into Phase 2B / 2C

Updated after the Phase 2A whole-branch review. Items that Phase 2A closed are
recorded as closed, because knowing something was deliberately resolved is as
useful as knowing something remains.

## Closed by Phase 2A

- **Step buckets while moving.** The headline item, and verified end to end
  rather than in isolation: 60 workers over 10 simulated minutes, **0 of 60**
  read as inactive via the vendored `isInactive` while working, and **0 of
  1440** sampled ticks read inactive during active work. A resting worker
  returns to exactly their resting rate and reads inactive again.
- **`buildReason`'s superseded prose table**, **`primary` as a constant
  contradicting the vendored `lead` column**, and **channel effects driven from
  `store.ts`** — all three closed by deleting `logic/routing.ts` and `store.ts`.
  Nothing consumed them once `AlertOrb` was retired, so deletion was the honest
  resolution rather than fixing code that could not execute.
- **`Fleet`'s parallel arrays** → one record per worker, created and destroyed
  as a unit. **`Fleet.start()` idempotency** → tears down first, which the Reset
  flow depends on. **`App.tsx` never stopping the fleet** → sixty sockets no
  longer outlive the component that opened them.
- **SpO2 was written once and never refreshed**, so it aged past the vendored
  15-minute staleness bound and every worker in the building turned amber with
  "SpO2 reading is stale" sixteen minutes into a demo.
- **Climbing was not exertion.** A worker on a portal holds position, so heart
  rate targeted *resting* while they climbed — measured falling 97 → 75 bpm
  mid-ascent, with `climbingBpm` unreachable in practice.

## Closed by the 2C build session (2026-08-10)

- **Machine variety.** Six kinds shared three bodies; each kind now has its own
  silhouette, and the construction site added five more (hoist, crane,
  generator, pump, welder). Eleven bodies, each with its own alert vocabulary.
- **Machines buried in grey blocks.** Every machine contributes a navmesh
  footprint to `obstacles`, and the floor drew every obstacle — so each machine
  stood inside its own crate. Footprints are tagged `kind: 'machine'` now;
  pathing takes them all, the renderer takes only structure.
- **Machine labels invisible.** Set at 0.19 m, which is four pixels at overview
  distance. Legible now, and shown on hover or alarm rather than always, since
  four per floor collided with each other.
- **Nothing could raise an alert.** `POST /simulations/events` now backs a
  per-machine dialog: real event id, real fan-out, counted by real analytics.
- **Nothing could reach `purgeCompany`.** An end-of-session control now clears
  the tenant, which is what makes a repeat demo honest.
- **No operator console.** A six-storey stack leaves most of a widescreen frame
  empty; it now carries headcount, per-floor distribution, and what is in alarm.
- **No worker interaction.** Clicking a worker opens their watch (the phone's
  own modality verdict, with ack and snooze) or their vitals dials, which
  backfill the buffer and leave the raise to the unmodified risk engine.
- **One site only.** The construction site is built, and the site is no longer a
  module-level import in four places.
- **No controlled worker.** Take control from the worker panel; WASD, arrows or
  click-to-move; FIFA-style chevron with his name, plus a ground ring; the
  camera follows him. Wiring click-to-move exposed two movement bugs that only
  appear on a long frame — a stall on every waypoint, and a 0.525 m step that
  could cross a 0.5 m obstacle cell without ever landing in it. Both fixed,
  both with regression tests.

## Closed by the palette-and-anchor session

- **The palette.** Rebuilt on one slate ramp with brass, in the scene and the
  interface together, tokenised by role. Contrast audited by measurement on
  every rendered text/background pair across three screens: clean.
- **The preview could not demonstrate a health raise.** The vendored risk
  engine now runs standalone when a worker has no account — same modules, same
  latch, same thresholds, no POST.
- **The geo anchor is placeable.** A pin in the scene sets which point of the
  site is the origin; a `SceneFrame` carries it, and both the phones and the
  machine alerts read it live, so moving it while the demo runs is safe.
  Property-tested: moving the origin preserves every distance inside the site
  and moves the site as a whole, which is exactly what makes it safe.

## Open — needs the user, cannot be finished without them

- **A physical phone**, to confirm the floor-mismatch prompt matches what the
  app actually shows, and that an alert raised here lands there. The
  coordinate side no longer needs them: "use my location" fills it from the
  browser, and the pin decides which spot in the building that coordinate is.
- **Profile-code / QR enrolment** of a real account into the simulated roster.

## Open — buildable, not yet built

- **The admin WebSocket** for `response_update`, so the console's alert list
  clears itself when a worker acks rather than needing the operator to.
- **Machine alerts are cleared by hand.** The list has a Clear button because
  nothing yet watches the server for resolution.

## Open — performance, and the first thing to do in 2C

The simulation is not the bottleneck and nothing in it is quadratic: at 60
workers the tick is p50 0.014 ms / p99 0.63 ms, and it scales linearly to 400.
**The renderer is the ceiling**, estimated at 25–40 fps on integrated graphics:

- `SimWorker` uses a per-worker `build` scale, so drei memoises a **distinct
  geometry per worker** — ~300–480 `RoundedBoxGeometry` instances — plus an
  inline material per mesh (~480 unshared). Quantise `build` to three or four
  buckets and the geometry count collapses.
- `React.memo` `SimWorker`: `Building` re-syncs ~16×/s and every worker
  re-renders because each gets a fresh `position` object.
- **15 lights** (12 point — two per floor — plus 3 directional, ambient,
  hemisphere). three.js compiles light counts into every standard material's
  shader, so this is the dominant per-fragment cost. Restrict point lights to
  the active floor and its neighbours.
- `qualityTier` exists, defaults to `'high'`, and is only settable from
  `window.__building` — so every worker is always fully detailed. Wire it to the
  startup frame-time sample the design calls for.

## Open — correctness and hygiene

- **`check:vendor` ignores `src/phone/vendor/__tests__/`.** A new file dropped
  there is neither drift-checked nor reverse-scanned. Verified still open.
- **A dirty mobile working tree defeats the commit pin.** Re-copying a vendored
  file from an uncommitted tree passes, while no longer matching `15b11d4`.
- **Eight `VirtualPhone` fixtures** call `seed(62, NOW)` with no SpO2, so they
  assess as `caution` / "No recent SpO2 reading" rather than `normal`. Test-only,
  but those tests now pass for a slightly different reason than intended.
- **The baseline-reader seam** is still module-level singleton state, mutated on
  every `Fleet.start()` with no teardown in `stop()`, and concatenates *all*
  workers' series — the wrong shape for a per-worker baseline. Make it
  per-worker or remove it.
- **No way back to the setup screen.** `fleet` is set once and never cleared, so
  Reset has nowhere to go.
- **`PhoneDeps.postResponse` still takes a token the fleet deliberately
  ignores.** A `VirtualPhone` built outside the fleet uses a frozen one. Drop
  the parameter and let the fleet bind it.
- **`outbox.ts` redeclares four contract types** instead of using the vendored
  ones, and its `ResponseAction` omits `auto_cancelled` and `reminder_sent`.
- **`VirtualPhone` hand-rolls dedup** with a `Set` while the vendored
  `realtime/alertDedup.ts` sits unused; they differ on malformed ids, on
  reminder keying, and on bounding.
- **`Building` mixes clocks:** it caps and scales `dtMs` but passes raw
  `Date.now()` as `nowMs`. Harmless at `TIME_SCALE = 1`, wrong otherwise.
- **`agent.ts` re-derives pathing's "which end am I arriving at" rule**
  independently of `pointOn`. Two implementations of one invariant.
- `hrSeries()` returns the live internal array by reference.
- `jitter()` is asymmetric — `(-spread, +spread)` then a fixed offset — so a
  seeded series skews low.

## Two tenants that cannot be cleaned up

The Task 1 registration probe and the first six-worker verification run were
created before `is_demo` existed on `POST /companies/register`. The flag is
settable only at registration, so those two are permanent. Every tenant created
since is purgeable, and every verification run purges its own.
