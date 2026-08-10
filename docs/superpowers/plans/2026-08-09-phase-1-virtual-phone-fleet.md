# Phase 1 — Virtual Phone Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up 60 simulated workers that each hold a real account, a real JWT and a real WebSocket against the deployed Twelve Senses server, and that each run Thalamus's own decision modules verbatim to decide — independently — whether an alert reaches them and through which channel.

**Architecture:** Four layers with a strict dependency direction — `net/` (HTTP + WebSocket) → `phone/` (a `VirtualPhone` per worker, wrapping vendored decision modules and a rolling vitals buffer) → `runtime/` (the fleet, the tick scheduler, scene↔WGS-84 conversion) → `scene/` (untouched in this phase). The decision modules are copied byte-for-byte from the mobile repo and never edited; where they import an Expo I/O shell, a stub module of the same name supplies only what they read.

**Tech Stack:** TypeScript, React 18, Vite 8, Vitest 4, Zustand 5 (all already in `scene-3d/package.json`). No new runtime dependencies.

## Global Constraints

- **Working directory is `scene-3d/`.** Every path in this plan is relative to it unless stated otherwise.
- **Deployed server:** `https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws`, base path `/api/v1`.
- **Vendored files are never edited.** Not for lint, not for formatting, not for imports. If a vendored file will not compile, the fix goes in the toolchain or in a stub — never in the file. Each carries a header naming its source path and commit.
- **No thresholds are altered.** `RISK_CONFIG`, `ALERT_CONFIG`, `NOISE_CONFIG`, `PROXIMITY_CONFIG` ship exactly as the app has them.
- **Mobile repo checkout** is assumed at `../../TwelveSense-TT-MobileApp/Thalamus` relative to `scene-3d/`. Source commit at time of writing: `15b11d4`.
- **No new npm dependencies** in this phase.
- **Never commit a real token, password or company id.** Generated demo credentials live in memory only.
- Run `npx tsc -p tsconfig.app.json --noEmit` before every commit; it must be clean.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/api/types.ts` | Vendored wire types — the shapes both repos build against |
| `src/phone/vendor/*` | Vendored decision modules, untouched |
| `src/phone/vendor/health/poller.ts` | Stub: only `POLL_INTERVAL_MS`, which `alerting.ts` reads |
| `src/phone/vendor/health/healthConnect.ts` | Stub: `readBaselineSeries`, backed by the sim's buffer |
| `src/net/config.ts` | Base URLs, resolved from env with a proxy-friendly default |
| `src/net/apiClient.ts` | Per-call-token JSON client, `ApiError`, timeouts, 401 refresh |
| `src/net/provisioning.ts` | Company → join code → N workers, concurrency-limited and resumable |
| `src/net/wsClient.ts` | Browser `WebSocket` wired into the vendored socket controller |
| `src/runtime/geo.ts` | Scene metres ↔ WGS-84 |
| `src/runtime/scheduler.ts` | Staggered tick loop over the fleet |
| `src/runtime/fleet.ts` | Owns every `VirtualPhone`; start, stop, reset |
| `src/phone/vitalsBuffer.ts` | Rolling 60-minute HR/SpO₂/steps buffer with trailing backfill |
| `src/phone/physiology.ts` | Activity → vitals drift |
| `src/phone/outbox.ts` | Idempotent response and health-alert POSTs |
| `src/phone/VirtualPhone.ts` | One worker's phone: socket, decisions, vitals, outbox |
| `src/ui/SetupScreen.tsx` | Site + worker count, Start, progress, Reset |
| `scripts/check-vendor.mjs` | Fails the build if a vendored copy has drifted |
| `scripts/probe-registration.mjs` | Task 1's throwaway registration probe |

**Modified:** `tsconfig.app.json`, `vite.config.ts`, `vitest.config.ts`, `package.json`, `src/App.tsx`.

---

### Task 1: Prove the server accepts synthetic identities

The spec flags this as the one unresolved risk (§3.3): `email` is a Pydantic `EmailStr`, and if the deployed build validates deliverability, every generated identity 422s and provisioning is dead on arrival. Nothing else in this plan is worth writing until this is known.

**Files:**
- Create: `scripts/probe-registration.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: a decision recorded in the plan — the email domain provisioning will use

- [ ] **Step 1: Write the probe**

```js
// scripts/probe-registration.mjs
// Throwaway probe: does the deployed server accept a synthetic email domain?
// Registers one company, then one worker, then stops. Leaves a dead tenant
// behind — that is expected and is why this runs once, by hand.
const BASE = 'https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws/api/v1';
const slug = `probe${Date.now().toString(36)}`;

const post = async (path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const company = await post('/companies/register', {
  company_name: `Probe ${slug}`,
  admin: {
    username: `${slug}-admin`,
    email: `admin@${slug}.sim.twelvesenses.io`,
    password: 'ProbePass123',
    first_name: 'Probe',
    last_name: 'Admin',
  },
});
console.log('company:', company.status, JSON.stringify(company.body).slice(0, 300));
if (company.status !== 201) process.exit(1);

const code = await post(
  '/enrollment-codes',
  { type: 'join', max_uses: null, expires_at: null },
  company.body.access_token,
);
console.log('code:', code.status, JSON.stringify(code.body).slice(0, 200));
if (code.status !== 201) process.exit(1);

const worker = await post('/auth/register', {
  code: code.body.code,
  username: `${slug}-w01`,
  email: `w01@${slug}.sim.twelvesenses.io`,
  password: 'ProbePass123',
  first_name: 'Probe',
  last_name: 'Worker',
  date_of_birth: '1990-05-12',
  gender: 'male',
});
console.log('worker:', worker.status, JSON.stringify(worker.body).slice(0, 300));
process.exit(worker.status === 201 ? 0 : 1);
```

- [ ] **Step 2: Run it**

Run: `node scripts/probe-registration.mjs`
Expected: three lines, statuses `201`, `201`, `201`, and exit code 0.

- [ ] **Step 3: Act on the result**

If all three are `201`, the domain `<session>.sim.twelvesenses.io` is confirmed — proceed with it and note the confirmation in the commit message.

If the worker step returns `422` with an email complaint, re-run the probe with `@gmail.com` addresses (`w01.<slug>@gmail.com`). If *that* passes, provisioning uses that pattern instead. Record whichever pattern passed — every later task depends on it.

If `/companies/register` itself fails with something other than an email error, stop and report; that is a server problem, not a plan problem.

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-registration.mjs
git commit -m "chore: probe whether the deployed server accepts synthetic identities

The one unknown that could have killed provisioning before it started:
email is a Pydantic EmailStr, and a build with deliverability checking on
would 422 every generated worker. Proven by hand against the deployment
before any provisioning code exists, so the answer shapes the code rather
than being discovered by it."
```

---

### Task 2: Toolchain — path alias, strict mode, dev proxy

The vendored modules import `@/api/types` and use value-position imports of type aliases. Both are incompatible with the current config: there is no `@` alias, and `verbatimModuleSyntax: true` turns `import { RiskBand }` into a runtime import of something that does not exist. The toolchain moves, not the vendored files.

`strict: true` was verified to produce **zero errors** on the existing scene, so it is free to enable.

**Files:**
- Modify: `tsconfig.app.json`, `vite.config.ts`, `vitest.config.ts`, `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: the `@/*` → `src/*` alias, and a dev proxy mounting the deployed API at `/api`

- [ ] **Step 1: Add the alias and strict mode to `tsconfig.app.json`**

Replace the `compilerOptions` block's `skipLibCheck` line and the Bundler-mode block with:

```json
    "skipLibCheck": true,
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
```

`verbatimModuleSyntax` and `erasableSyntaxOnly` are **removed**. The first breaks vendored value-position type imports; the second is unnecessary once the first is gone and keeping it invites a future vendored file to fail for an unrelated reason.

- [ ] **Step 2: Add the alias and the dev proxy to `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const DEPLOYED = 'https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws';

// The deployed server has no CORS middleware (docs/superpowers/specs/
// 2026-08-09-demo-simulator-design.md §3.1), so a browser cannot call it
// directly. This proxy makes the API same-origin in dev. WebSockets are
// exempt from CORS and connect straight to the deployment, so `ws: true`
// here is belt-and-braces for anyone who points WS_URL at the proxy too.
// When the server ships CORSMiddleware this whole block can go.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': { target: DEPLOYED, changeOrigin: true, secure: true, ws: true },
    },
  },
});
```

- [ ] **Step 3: Mirror the alias in `vitest.config.ts` and widen its test glob**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Decision modules are pure functions — no DOM needed, so the fast node env.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/phone/**/*.ts', 'src/net/**/*.ts', 'src/runtime/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
```

- [ ] **Step 4: Verify nothing broke**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run test:run`
Expected: no TypeScript errors; the existing `src/logic/routing.test.ts` still passes.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.app.json vite.config.ts vitest.config.ts
git commit -m "build: alias @/ to src, enable strict, proxy /api to the deployment

Three changes the vendored decision modules require, made in the toolchain
rather than in the files: the @/ alias they import through, and the removal
of verbatimModuleSyntax, which would otherwise compile their value-position
imports of type aliases into runtime imports of bindings that do not exist.

strict was verified to produce zero errors on the existing scene first, so
it costs nothing to turn on and protects everything written from here.

The proxy exists because the deployed server has no CORS middleware, which
React Native never had to care about. It is deleted, not kept, once the
server ships CORSMiddleware."
```

---

### Task 3: Vendor the wire types

**Files:**
- Create: `src/api/types.ts` (copied)
- Test: `src/api/__tests__/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Modality`, `RiskBand`, `ContextSnapshot`, `FloorGate`, `GpsGate`, `ProximityFallback`, `EventOut`, `WsMessage`, `ResponseAction`, and the request/response shapes the client uses

- [ ] **Step 1: Copy the file verbatim**

```bash
cp ../../TwelveSense-TT-MobileApp/Thalamus/src/api/types.ts src/api/types.ts
```

- [ ] **Step 2: Prepend the provenance header**

Insert these lines at the very top, above the existing content. This is the **only** permitted modification to a vendored file, and it adds no code:

```ts
/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/api/types.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
```

- [ ] **Step 3: Write a test that pins the shapes the sim depends on**

```ts
// src/api/__tests__/types.test.ts
import { describe, expect, it } from 'vitest';
import type { Modality, RiskBand, ContextSnapshot } from '@/api/types';

describe('vendored wire types', () => {
  it('models Modality as three independent channels', () => {
    const m: Modality = { visual: true, haptic: true, sound: false };
    expect(Object.keys(m).sort()).toEqual(['haptic', 'sound', 'visual']);
  });

  it('admits every risk band the engine can return', () => {
    const bands: RiskBand[] = ['normal', 'caution', 'danger'];
    expect(bands).toHaveLength(3);
  });

  it('lets a context snapshot carry the proximity decision record', () => {
    const snap: ContextSnapshot = {
      worker_floor: '4',
      event_floor: '4',
      floor_gate: 'match',
      gps_gate: 'in_range',
      gps_age_s: 9,
      fallbacks: [],
    };
    expect(snap.floor_gate).toBe('match');
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/api/__tests__/types.test.ts`
Expected: PASS, 3 tests. If it fails to resolve `@/api/types`, Task 2's alias did not land in `vitest.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/__tests__/types.test.ts
git commit -m "feat: vendor the wire types from the mobile app

The shapes both repos build against, copied rather than re-declared so the
simulator cannot drift from the contract the phone implements."
```

---

### Task 4: Vendor the decision modules and their stubs

The heart of the design: these files are the app's behaviour, and they run here unchanged. Two of them import Expo I/O shells; those shells get same-named stubs that expose only what the decision module reads.

**Files:**
- Create: `src/phone/vendor/realtime/proximity.ts`, `src/phone/vendor/realtime/socket.ts`, `src/phone/vendor/realtime/alertDedup.ts`, `src/phone/vendor/realtime/eventLifecycle.ts`, `src/phone/vendor/context/modality.ts`, `src/phone/vendor/context/ambientContext.ts`, `src/phone/vendor/health/risk.ts`, `src/phone/vendor/health/vitals.ts`, `src/phone/vendor/health/alerting.ts`, `src/phone/vendor/health/baseline.ts`
- Create (stubs): `src/phone/vendor/health/poller.ts`, `src/phone/vendor/health/healthConnect.ts`
- Create: `scripts/check-vendor.mjs`
- Modify: `package.json`
- Test: the mobile repo's own tests for these modules, copied alongside

**Interfaces:**
- Consumes: `@/api/types` (Task 3)
- Produces: `decideProximity(input, config?) → ProximityVerdict`, `proximityContextSnapshot(input, verdict) → ContextSnapshot`, `PROXIMITY_CONFIG`, `haversineMeters(lat1, lon1, lat2, lon2) → number`; `decideModality(ctx) → Modality`; `classifyContext(raw, config?) → { motion, noise }`, `classifyMotion`, `classifyNoise`, `NOISE_CONFIG`; `assessRisk(inputs) → RiskAssessment`, `RISK_CONFIG`, `hrMaxForAge(age)`, `ageFromDob(dobIso, nowIso)`; `nextAlertState(state, assessment) → AlertTick`, `INITIAL_LATCH`, `ALERT_CONFIG`; `createWsController(deps) → WsController`, `parseWsMessage(data)`

- [ ] **Step 1: Copy the modules and their tests**

```bash
M=../../TwelveSense-TT-MobileApp/Thalamus/src
mkdir -p src/phone/vendor/{realtime,context,health} src/phone/vendor/__tests__

cp $M/realtime/proximity.ts       src/phone/vendor/realtime/
cp $M/realtime/socket.ts          src/phone/vendor/realtime/
cp $M/realtime/alertDedup.ts      src/phone/vendor/realtime/
cp $M/realtime/eventLifecycle.ts  src/phone/vendor/realtime/
cp $M/context/modality.ts         src/phone/vendor/context/
cp $M/context/ambientContext.ts   src/phone/vendor/context/
cp $M/health/risk.ts              src/phone/vendor/health/
cp $M/health/vitals.ts            src/phone/vendor/health/
cp $M/health/alerting.ts          src/phone/vendor/health/
cp $M/health/baseline.ts          src/phone/vendor/health/

cp $M/realtime/__tests__/proximity.test.ts   src/phone/vendor/__tests__/
cp $M/realtime/__tests__/socket.test.ts      src/phone/vendor/__tests__/
cp $M/realtime/__tests__/alertDedup.test.ts  src/phone/vendor/__tests__/
cp $M/context/__tests__/modality.test.ts     src/phone/vendor/__tests__/
cp $M/context/__tests__/ambientContext.test.ts src/phone/vendor/__tests__/
cp $M/health/__tests__/risk.test.ts          src/phone/vendor/__tests__/
cp $M/health/__tests__/alerting.test.ts      src/phone/vendor/__tests__/
cp $M/health/__tests__/vitals.test.ts        src/phone/vendor/__tests__/
```

Copied tests import their subject by relative path (`../modality`) or alias. Any that use a relative path now resolve one directory too high; fix **the copied test's import path only** — tests are fixtures here, not vendored contract, and the modules themselves stay untouched.

- [ ] **Step 2: Write the two stubs**

```ts
// src/phone/vendor/health/poller.ts
/* STUB for a vendored dependency — not a copy.
 * `alerting.ts` imports POLL_INTERVAL_MS from the app's vitals poller, an Expo
 * foreground-service shell the simulator does not have. Only the constant is
 * read, and it is reproduced verbatim so `ALERT_CONFIG.latchMaxAgeMs`
 * (= recoveryTicks × this) keeps the value the app computes.
 * Source of the value: Thalamus/src/health/poller.ts @ 15b11d4
 */
export const POLL_INTERVAL_MS = 60_000;
```

```ts
// src/phone/vendor/health/healthConnect.ts
/* STUB for a vendored dependency — not a copy.
 * `baseline.ts`/`restingBaseline.ts` read a trailing series from Health
 * Connect. The simulator's own vitals buffer is that series, so this module is
 * a seam: the fleet installs a reader at start-up and the vendored code calls
 * it without knowing the difference.
 */
import type { VitalReading } from './vitals';

export type BaselineSeriesReader = (days: number) => Promise<VitalReading[]>;

let reader: BaselineSeriesReader = async () => [];

/** Called once by the fleet; the vendored baseline code never sees this. */
export function installBaselineSeriesReader(next: BaselineSeriesReader): void {
  reader = next;
}

export function readBaselineSeries(days: number): Promise<VitalReading[]> {
  return reader(days);
}
```

- [ ] **Step 3: Write the drift checker**

```js
// scripts/check-vendor.mjs
// Fails if a vendored copy has drifted from the mobile repo. Compares content
// ignoring the provenance header the copy carries. Stubs are listed as
// deliberate exceptions — they are not copies and must not be compared.
import { readFileSync, existsSync } from 'node:fs';

const MOBILE = process.env.MOBILE_SRC ?? '../../TwelveSense-TT-MobileApp/Thalamus/src';

const COPIES = [
  ['src/api/types.ts', 'api/types.ts'],
  ['src/phone/vendor/realtime/proximity.ts', 'realtime/proximity.ts'],
  ['src/phone/vendor/realtime/socket.ts', 'realtime/socket.ts'],
  ['src/phone/vendor/realtime/alertDedup.ts', 'realtime/alertDedup.ts'],
  ['src/phone/vendor/realtime/eventLifecycle.ts', 'realtime/eventLifecycle.ts'],
  ['src/phone/vendor/context/modality.ts', 'context/modality.ts'],
  ['src/phone/vendor/context/ambientContext.ts', 'context/ambientContext.ts'],
  ['src/phone/vendor/health/risk.ts', 'health/risk.ts'],
  ['src/phone/vendor/health/vitals.ts', 'health/vitals.ts'],
  ['src/phone/vendor/health/alerting.ts', 'health/alerting.ts'],
  ['src/phone/vendor/health/baseline.ts', 'health/baseline.ts'],
];

/** Drop a leading `/* VENDORED ... *\/` block so the header is not a diff. */
const stripHeader = (s) => s.replace(/^\/\* VENDORED[\s\S]*?\*\/\r?\n/, '');
const normalize = (s) => stripHeader(s).replace(/\r\n/g, '\n').trimEnd();

let drifted = 0;
for (const [local, upstream] of COPIES) {
  const upstreamPath = `${MOBILE}/${upstream}`;
  if (!existsSync(upstreamPath)) {
    console.error(`MISSING UPSTREAM  ${upstreamPath}`);
    drifted++;
    continue;
  }
  if (normalize(readFileSync(local, 'utf8')) !== normalize(readFileSync(upstreamPath, 'utf8'))) {
    console.error(`DRIFTED  ${local}  !=  ${upstreamPath}`);
    drifted++;
  }
}

if (drifted > 0) {
  console.error(`\n${drifted} vendored file(s) drifted. Re-copy them; do not edit them.`);
  process.exit(1);
}
console.log(`${COPIES.length} vendored files match the mobile repo.`);
```

- [ ] **Step 4: Register the script**

In `package.json`, add to `scripts`:

```json
    "check:vendor": "node scripts/check-vendor.mjs",
```

- [ ] **Step 5: Run everything**

Run: `npm run check:vendor && npx tsc -p tsconfig.app.json --noEmit && npm run test:run`
Expected: `11 vendored files match the mobile repo.`, no TypeScript errors, and the copied mobile tests pass **unchanged**. That last part is the whole point: it is the proof the vendored copies really are the app's behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/phone/vendor src/api/__tests__ scripts/check-vendor.mjs package.json
git commit -m "feat: vendor the app's decision modules, verbatim, with their tests

proximity, modality, ambient context, risk, alerting, vitals, baseline,
alertDedup, eventLifecycle and the socket controller — copied byte-for-byte
from the mobile repo and never edited. Their own tests come with them and
pass unchanged, which is the evidence that the simulator decides exactly
what a phone decides rather than merely claiming to.

Two of them import Expo I/O shells the simulator has no equivalent of.
Those get same-named stubs exposing only what the decision module reads:
poller.ts carries POLL_INTERVAL_MS verbatim so latchMaxAgeMs keeps the
value the app computes, and healthConnect.ts becomes the seam the fleet
installs the sim's own vitals buffer into.

check:vendor diffs every copy against the mobile repo and fails on drift,
so the divergence that already happened once — the still+quiet modality
row — is caught at build time instead of in front of a client."
```

---

### Task 5: Scene ↔ WGS-84 conversion

Makes proximity real: a worker's GPS fix derives from where they are standing, so `decideProximity` runs the true haversine on true coordinates.

**Files:**
- Create: `src/runtime/geo.ts`
- Test: `src/runtime/__tests__/geo.test.ts`

**Interfaces:**
- Consumes: `haversineMeters` from `@/phone/vendor/realtime/proximity`
- Produces: `type LatLon = { latitude: number; longitude: number }`, `sceneToLatLon(anchor: LatLon, x: number, z: number) → LatLon`, `latLonToScene(anchor: LatLon, at: LatLon) → { x: number; z: number }`, `METERS_PER_DEG_LAT`

- [ ] **Step 1: Write the failing test**

```ts
// src/runtime/__tests__/geo.test.ts
import { describe, expect, it } from 'vitest';
import { haversineMeters } from '@/phone/vendor/realtime/proximity';
import { latLonToScene, sceneToLatLon } from '@/runtime/geo';

const ANCHOR = { latitude: 30.04412, longitude: 31.23571 };

describe('geo', () => {
  it('returns the anchor itself at the scene origin', () => {
    const at = sceneToLatLon(ANCHOR, 0, 0);
    expect(at.latitude).toBeCloseTo(ANCHOR.latitude, 10);
    expect(at.longitude).toBeCloseTo(ANCHOR.longitude, 10);
  });

  it('round-trips scene metres through lat/lon', () => {
    const { x, z } = latLonToScene(ANCHOR, sceneToLatLon(ANCHOR, 42.5, -137.25));
    expect(x).toBeCloseTo(42.5, 6);
    expect(z).toBeCloseTo(-137.25, 6);
  });

  it('agrees with the vendored haversine on a known offset', () => {
    // 100 m north of the anchor, measured by the same function the gate uses
    const north = sceneToLatLon(ANCHOR, 0, 100);
    const measured = haversineMeters(
      ANCHOR.latitude, ANCHOR.longitude, north.latitude, north.longitude,
    );
    expect(measured).toBeCloseTo(100, 0);
  });

  it('agrees with the vendored haversine on an east offset', () => {
    const east = sceneToLatLon(ANCHOR, 75, 0);
    const measured = haversineMeters(
      ANCHOR.latitude, ANCHOR.longitude, east.latitude, east.longitude,
    );
    expect(measured).toBeCloseTo(75, 0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/runtime/__tests__/geo.test.ts`
Expected: FAIL — cannot resolve `@/runtime/geo`.

- [ ] **Step 3: Implement**

```ts
// src/runtime/geo.ts
/**
 * Scene metres ↔ WGS-84.
 *
 * The simulator's proximity story only means anything if the coordinates are
 * real: machines carry genuine lat/lon, a worker's GPS fix derives from where
 * they are actually standing, and the vendored `decideProximity` runs the true
 * haversine over both. This module is the whole of that mapping.
 *
 * A local tangent-plane approximation is deliberate and sufficient: a site is
 * a few hundred metres across, where the error against a full geodesic is
 * millimetres — far below the metre-scale radii the gate compares.
 *
 * Scene convention: +x is east, +z is north, both in metres.
 */

export type LatLon = { latitude: number; longitude: number };

/** Metres per degree of latitude — constant enough at site scale. */
export const METERS_PER_DEG_LAT = 111_320;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Metres per degree of longitude shrinks with latitude by cos(lat). */
const metersPerDegLon = (latitude: number) =>
  METERS_PER_DEG_LAT * Math.cos(toRad(latitude));

export function sceneToLatLon(anchor: LatLon, x: number, z: number): LatLon {
  const latitude = anchor.latitude + z / METERS_PER_DEG_LAT;
  return { latitude, longitude: anchor.longitude + x / metersPerDegLon(latitude) };
}

export function latLonToScene(anchor: LatLon, at: LatLon): { x: number; z: number } {
  const z = (at.latitude - anchor.latitude) * METERS_PER_DEG_LAT;
  return { x: (at.longitude - anchor.longitude) * metersPerDegLon(at.latitude), z };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/runtime/__tests__/geo.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/geo.ts src/runtime/__tests__/geo.test.ts
git commit -m "feat: map scene metres to real coordinates

Machines get genuine lat/lon and workers get a fix derived from where they
are standing, so the vendored proximity gate measures a real distance. The
out-of-range demo beat then works because the arithmetic says so, not
because the simulator was told to suppress the alert.

A tangent-plane approximation, deliberately: at site scale its error against
a full geodesic is millimetres, against radii measured in tens of metres."
```

---

### Task 6: The HTTP client

Differs from the app's client in one structural way: the phone has **one** token and a global provider, the simulator has 60 and must pass a token per call.

**Files:**
- Create: `src/net/config.ts`, `src/net/apiClient.ts`
- Test: `src/net/__tests__/apiClient.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `API_BASE_URL`, `WS_URL`, `class ApiError { status: number; code: string; details?: Record<string, unknown> }`, `apiRequest<T>(method, path, opts: { body?, token?, timeoutMs? }) → Promise<T>`, `newClientEventId() → string`

- [ ] **Step 1: Write the config module**

```ts
// src/net/config.ts
/**
 * Where the simulator talks to.
 *
 * REST defaults to the same-origin path `/api/v1`, which Vite's dev proxy
 * forwards to the deployment — the deployed server has no CORS middleware, so
 * a browser cannot call it cross-origin (design doc §3.1). Once the server
 * ships CORSMiddleware, point VITE_API_BASE_URL straight at it and the proxy
 * stops mattering.
 *
 * WebSockets are exempt from CORS, so they go direct and always have.
 */
const DEPLOYED_WS = 'wss://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws/api/v1/ws';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const WS_URL = import.meta.env.VITE_WS_URL ?? DEPLOYED_WS;
```

- [ ] **Step 2: Write the failing test**

```ts
// src/net/__tests__/apiClient.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, newClientEventId } from '@/net/apiClient';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('sends the per-call bearer token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('GET', '/auth/me', { token: 'tok-42' });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-42');
  });

  it('omits Authorization when no token is given', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('POST', '/auth/login', { body: { username_or_email: 'a' } });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces a structured 409 detail as code and details', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(409, {
        detail: { code: 'event_already_resolved', resolved_by: 'w-1' },
      }),
    );

    const err = await apiRequest('POST', '/events/e1/responses', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('event_already_resolved');
    expect(err.details?.resolved_by).toBe('w-1');
  });

  it('turns a FastAPI 422 array into a readable message', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(422, {
        detail: [{ loc: ['body', 'email'], msg: 'not a valid email address' }],
      }),
    );

    const err = await apiRequest('POST', '/auth/register', {}).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toBe('email: not a valid email address');
  });

  it('keeps the status when the body is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));

    const err = await apiRequest('GET', '/events', {}).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.code).toBe('non_json_response');
  });
});

describe('newClientEventId', () => {
  it('produces distinct v4-shaped ids', () => {
    const a = newClientEventId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(newClientEventId());
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run src/net/__tests__/apiClient.test.ts`
Expected: FAIL — cannot resolve `@/net/apiClient`.

- [ ] **Step 4: Implement**

```ts
// src/net/apiClient.ts
/**
 * JSON client for the Twelve Senses server.
 *
 * The one structural difference from the app's `api/client.ts`: the phone has a
 * single session and reads its token from a global provider, while the
 * simulator holds sixty and must pass one per call. Everything else — the error
 * envelope, the 422 array flattening, the non-JSON guard — mirrors the app,
 * because the failures it learned to handle are the failures this will meet.
 */
import { API_BASE_URL } from './config';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    opts: { code?: string; status: number; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code ?? 'unknown';
    this.status = opts.status;
    this.details = opts.details;
  }
}

export type RequestOptions = {
  body?: unknown;
  token?: string | null;
  /** abort after this long; `fetch` has no timeout of its own */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * FastAPI answers a 422 with `detail` as an ARRAY of validation errors, which
 * is neither a string nor the object a 409 carries. Left unhandled the message
 * collapses to an empty statusText and the caller learns nothing — the exact
 * failure that made the app report a missing `code` field as "can't reach the
 * server". The leading `body`/`query` scope of `loc` is dropped.
 */
function validationMessage(detail: unknown): string | undefined {
  if (!Array.isArray(detail) || detail.length === 0) return undefined;
  const parts = detail
    .map((item) => {
      if (item === null || typeof item !== 'object') return null;
      const { loc, msg } = item as { loc?: unknown; msg?: unknown };
      if (typeof msg !== 'string') return null;
      const field = Array.isArray(loc) ? loc.slice(1).filter((p) => typeof p === 'string') : [];
      return field.length > 0 ? `${field.join('.')}: ${msg}` : msg;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  { body, token, timeoutMs = DEFAULT_TIMEOUT_MS, signal }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    // Not everything on the wire is JSON: the AWS edge answers an unhealthy
    // backend with an HTML 502/503. An unguarded parse throws a SyntaxError and
    // erases the status, which every caller branches on.
    let data: unknown;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(res.statusText || `HTTP ${res.status}`, {
          code: 'non_json_response',
          status: res.status,
        });
      }
    }

    if (!res.ok) {
      const detail = (data as { detail?: unknown } | undefined)?.detail;
      const structured =
        detail !== null && typeof detail === 'object' && !Array.isArray(detail)
          ? (detail as Record<string, unknown>)
          : undefined;
      const code = typeof structured?.code === 'string' ? structured.code : undefined;

      throw new ApiError(
        validationMessage(detail) ??
          code ??
          (typeof detail === 'string' ? detail : res.statusText) ??
          `HTTP ${res.status}`,
        { code, status: res.status, details: structured },
      );
    }

    return data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Client-generated idempotency key for response and analytics POSTs. */
export function newClientEventId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `npx vitest run src/net/__tests__/apiClient.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/net/config.ts src/net/apiClient.ts src/net/__tests__/apiClient.test.ts
git commit -m "feat: JSON client with a per-call token

The phone reads one token from a global provider; the simulator holds sixty
and passes one per call, which is the only structural difference from the
app's client. The error handling is deliberately the app's: the 422-array
flattening and the non-JSON guard exist because the deployment's edge really
does answer with HTML, and losing the status code there once already turned
a validation error into 'can't reach the server'."
```

---

### Task 7: Provisioning

**Files:**
- Create: `src/net/provisioning.ts`
- Test: `src/net/__tests__/provisioning.test.ts`

**Interfaces:**
- Consumes: `apiRequest`, `ApiError` (Task 6)
- Produces:
  - `type ProvisionedWorker = { index: number; userId: string; username: string; email: string; password: string; firstName: string; lastName: string; dateOfBirth: string; accessToken: string; refreshToken: string }`
  - `type ProvisionedSession = { slug: string; companyId: string; companyName: string; adminUserId: string; adminAccessToken: string; adminRefreshToken: string; joinCode: string; workers: ProvisionedWorker[] }`
  - `newSessionSlug() → string`
  - `workerIdentity(slug: string, index: number) → { username; email; password; firstName; lastName; dateOfBirth }`
  - `provisionCompany(slug: string, siteLabel: string) → Promise<ProvisionedSession>` (the session carries no `workers` field — workers are returned separately by `provisionWorkers`, so a partial failure never leaves a half-populated session object)
  - `provisionWorkers(session, count, onProgress?) → Promise<ProvisionedWorker[]>`
  - `PROVISION_CONCURRENCY = 8`

- [ ] **Step 1: Write the failing test**

```ts
// src/net/__tests__/provisioning.test.ts
import { describe, expect, it, vi } from 'vitest';
import { newSessionSlug, provisionWorkers, workerIdentity } from '@/net/provisioning';

const session = {
  slug: 'abc123',
  companyId: 'c-1',
  companyName: 'Demo',
  adminUserId: 'a-1',
  adminAccessToken: 'admin-tok',
  adminRefreshToken: 'admin-ref',
  joinCode: 'DEMO-7F3Q',
};

describe('workerIdentity', () => {
  it('carries the session slug, because identifiers are unique platform-wide', () => {
    const id = workerIdentity('abc123', 1);
    expect(id.username).toContain('abc123');
    expect(id.email).toContain('abc123');
  });

  it('pads the index so worker 1 sorts before worker 10', () => {
    expect(workerIdentity('s', 1).username.endsWith('w01')).toBe(true);
    expect(workerIdentity('s', 10).username.endsWith('w10')).toBe(true);
  });

  it('varies date of birth, because hrMaxForAge depends on it', () => {
    const dobs = new Set(
      Array.from({ length: 20 }, (_, i) => workerIdentity('s', i + 1).dateOfBirth),
    );
    expect(dobs.size).toBeGreaterThan(1);
  });

  it('meets the register schema: username >= 3 chars, password 8-72 bytes', () => {
    const id = workerIdentity('abc123', 7);
    expect(id.username.length).toBeGreaterThanOrEqual(3);
    expect(id.password.length).toBeGreaterThanOrEqual(8);
    expect(new TextEncoder().encode(id.password).length).toBeLessThanOrEqual(72);
  });
});

describe('newSessionSlug', () => {
  it('is short and url-safe', () => {
    expect(newSessionSlug()).toMatch(/^[a-z0-9]{4,12}$/);
  });
});

describe('provisionWorkers', () => {
  it('registers the requested number and reports progress', async () => {
    const seen: number[] = [];
    const post = vi.fn(async (_path: string, body: { username: string }) => ({
      worker: { id: `u-${body.username}` },
      access_token: 'a',
      refresh_token: 'r',
    }));

    const workers = await provisionWorkers(session, 5, (done) => seen.push(done), post);

    expect(workers).toHaveLength(5);
    expect(post).toHaveBeenCalledTimes(5);
    expect(seen.at(-1)).toBe(5);
  });

  it('never exceeds the concurrency limit', async () => {
    let live = 0;
    let peak = 0;
    const post = vi.fn(async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return { worker: { id: 'u' }, access_token: 'a', refresh_token: 'r' };
    });

    await provisionWorkers(session, 30, undefined, post);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('resumes from an index so a partial failure re-registers only the gap', async () => {
    const post = vi.fn(async () => ({
      worker: { id: 'u' }, access_token: 'a', refresh_token: 'r',
    }));

    const workers = await provisionWorkers(session, 10, undefined, post, 6);

    expect(workers).toHaveLength(4);
    expect(workers[0].index).toBe(7);
    expect(post).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/net/__tests__/provisioning.test.ts`
Expected: FAIL — cannot resolve `@/net/provisioning`.

- [ ] **Step 3: Implement**

```ts
// src/net/provisioning.ts
/**
 * Stand up a demo tenant: a company, a reusable join code, and N workers.
 *
 * Everything here exists because of one server rule — `username` and `email`
 * are unique PLATFORM-WIDE, not per company (api-contract.md, POST
 * /auth/register). Every generated identity therefore carries a session slug,
 * and a demo run never collides with the one before it.
 *
 * Reset re-runs this against a fresh company rather than clearing an old one:
 * the server has no delete endpoints (design doc §3.2).
 */
import { apiRequest } from './apiClient';

export const PROVISION_CONCURRENCY = 8;

/** Long enough to be unguessable in a demo, inside the 8-72 byte bcrypt range. */
const DEMO_PASSWORD = 'TwelveDemo2026';

const FIRST_NAMES = [
  'Ahmed', 'Sarah', 'Omar', 'Fatima', 'Carlos', 'Mei', 'Youssef', 'Elena',
  'Rahul', 'Grace', 'Tomas', 'Aisha', 'Daniel', 'Nadia', 'Peter', 'Layla',
  'Hassan', 'Marta', 'Kwame', 'Ingrid',
];
const LAST_NAMES = [
  'Al-Rashidi', 'Mitchell', 'Hassan', 'Al-Zahra', 'Reyes', 'Chen', 'Farouk',
  'Petrova', 'Sharma', 'Okonkwo', 'Novak', 'Haddad', 'Fischer', 'Karim',
  'Lindqvist', 'Costa', 'Mensah', 'Dubois',
];

export type WorkerIdentity = {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
};

export type ProvisionedWorker = WorkerIdentity & {
  index: number;
  userId: string;
  accessToken: string;
  refreshToken: string;
};

export type ProvisionedSession = {
  slug: string;
  companyId: string;
  companyName: string;
  adminUserId: string;
  adminAccessToken: string;
  adminRefreshToken: string;
  joinCode: string;
};

export function newSessionSlug(): string {
  return Date.now().toString(36).slice(-6);
}

/**
 * Ages span 22-58 so `hrMaxForAge` (Tanaka: 208 − 0.7·age) differs per worker.
 * A fleet that shared one age would make the exertion rule fire at the same
 * heart rate for everyone, which is the opposite of the point.
 */
export function workerIdentity(slug: string, index: number): WorkerIdentity {
  const n = String(index).padStart(2, '0');
  const birthYear = 2004 - ((index * 7) % 37);
  return {
    username: `sim-${slug}-w${n}`,
    email: `w${n}@${slug}.sim.twelvesenses.io`,
    password: DEMO_PASSWORD,
    firstName: FIRST_NAMES[index % FIRST_NAMES.length],
    lastName: LAST_NAMES[(index * 3) % LAST_NAMES.length],
    dateOfBirth: `${birthYear}-0${(index % 9) + 1}-1${index % 9}`,
  };
}

type AuthResponse = {
  worker?: { id: string };
  user?: { id: string };
  access_token: string;
  refresh_token: string;
};

/** Injected in tests; production passes the real call through. */
export type RegisterFn = (path: string, body: Record<string, unknown>) => Promise<AuthResponse>;

const realRegister: RegisterFn = (path, body) =>
  apiRequest<AuthResponse>('POST', path, { body });

export async function provisionCompany(
  slug: string,
  siteLabel: string,
  register: RegisterFn = realRegister,
): Promise<ProvisionedSession> {
  const companyName = `Demo ${siteLabel} ${slug}`;
  const company = await register('/companies/register', {
    company_name: companyName,
    admin: {
      username: `sim-${slug}-admin`,
      email: `admin@${slug}.sim.twelvesenses.io`,
      password: DEMO_PASSWORD,
      first_name: 'Demo',
      last_name: 'Admin',
    },
  });

  const adminToken = company.access_token;
  const code = await apiRequest<{ code: string }>('POST', '/enrollment-codes', {
    token: adminToken,
    body: { type: 'join', max_uses: null, expires_at: null },
  });

  const admin = company.user ?? company.worker;
  return {
    slug,
    companyId: (company as unknown as { company?: { id: string } }).company?.id ?? '',
    companyName,
    adminUserId: admin?.id ?? '',
    adminAccessToken: adminToken,
    adminRefreshToken: company.refresh_token,
    joinCode: code.code,
  };
}

/**
 * Register workers `fromIndex+1 … count`, at most PROVISION_CONCURRENCY in
 * flight. `fromIndex` is what makes a partial failure recoverable: the setup
 * screen retries from the count it already has instead of re-registering
 * everyone into 409s.
 */
export async function provisionWorkers(
  session: ProvisionedSession,
  count: number,
  onProgress?: (done: number, total: number) => void,
  register: RegisterFn = realRegister,
  fromIndex = 0,
): Promise<ProvisionedWorker[]> {
  const indices = Array.from({ length: count - fromIndex }, (_, i) => fromIndex + i + 1);
  const out: ProvisionedWorker[] = new Array(indices.length);
  let cursor = 0;
  let done = fromIndex;

  const runner = async () => {
    while (cursor < indices.length) {
      const slot = cursor++;
      const index = indices[slot];
      const id = workerIdentity(session.slug, index);
      const res = await register('/auth/register', {
        code: session.joinCode,
        username: id.username,
        email: id.email,
        password: id.password,
        first_name: id.firstName,
        last_name: id.lastName,
        date_of_birth: id.dateOfBirth,
      });
      out[slot] = {
        ...id,
        index,
        userId: (res.worker ?? res.user)?.id ?? '',
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
      };
      onProgress?.(++done, count);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PROVISION_CONCURRENCY, indices.length) }, runner),
  );
  return out;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/net/__tests__/provisioning.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/net/provisioning.ts src/net/__tests__/provisioning.test.ts
git commit -m "feat: provision a demo tenant — company, join code, N workers

Every generated identity carries a session slug because the server's
username and email uniqueness is platform-wide, not per company, so a second
demo would otherwise collide with the first on worker one.

Ages span 22-58 rather than sharing a default: hrMaxForAge is Tanaka's
208 - 0.7*age, and a fleet with one age would cross the exertion threshold
at an identical heart rate for all sixty people.

Registration is concurrency-limited to 8 and resumable from an index, so a
failure halfway through 60 retries the gap instead of re-registering
everyone into 409s."
```

---

### Task 8: The WebSocket client

The vendored `socket.ts` is fully dependency-injected, so this task supplies a browser `WebSocket` and real timers — no connection policy is rewritten.

**Files:**
- Create: `src/net/wsClient.ts`
- Test: `src/net/__tests__/wsClient.test.ts`

**Interfaces:**
- Consumes: `createWsController`, `WsLike`, `WsStatus`, `WsController` from `@/phone/vendor/realtime/socket`; `WS_URL` from `@/net/config`
- Produces: `connectPhoneSocket(opts: { getAccessToken: () => string | null; refreshAccessToken: () => Promise<string | null>; onMessage: (m: WsMessage) => void; onStatus: (s: WsStatus) => void }) → WsController`

- [ ] **Step 1: Write the failing test**

```ts
// src/net/__tests__/wsClient.test.ts
import { describe, expect, it, vi } from 'vitest';
import { browserSocketFactory } from '@/net/wsClient';

describe('browserSocketFactory', () => {
  it('constructs a socket at the url it is given', () => {
    const ctor = vi.fn(function (this: Record<string, unknown>, url: string) {
      this.url = url;
    });
    vi.stubGlobal('WebSocket', ctor);

    browserSocketFactory('wss://example/api/v1/ws?token=abc');

    expect(ctor).toHaveBeenCalledWith('wss://example/api/v1/ws?token=abc');
    vi.unstubAllGlobals();
  });

  it('exposes the handler properties the vendored controller assigns', () => {
    class FakeSocket {
      onopen: unknown = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      onclose: unknown = null;
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);

    const s = browserSocketFactory('wss://example/ws');
    s.onopen = () => {};
    s.onmessage = () => {};

    expect(typeof s.send).toBe('function');
    expect(typeof s.close).toBe('function');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/net/__tests__/wsClient.test.ts`
Expected: FAIL — cannot resolve `@/net/wsClient`.

- [ ] **Step 3: Implement**

```ts
// src/net/wsClient.ts
/**
 * The live channel, using the app's own connection policy.
 *
 * `phone/vendor/realtime/socket.ts` takes its socket, timers and jitter source
 * as dependencies, so the whole of the reconnect behaviour — exponential
 * backoff with jitter, the stable-open reset, the 4401 single-flight refresh
 * and its consecutive-failure guard, answering `ping` with `pong` — is the
 * app's, unmodified. This module only supplies the browser's implementations.
 *
 * WebSockets are exempt from CORS, so this connects straight to the deployment
 * even while REST goes through the dev proxy.
 */
import type { WsMessage } from '@/api/types';
import {
  createWsController,
  type WsController,
  type WsLike,
  type WsStatus,
} from '@/phone/vendor/realtime/socket';
import { WS_URL } from './config';

/** The browser WebSocket already has the shape the controller drives. */
export function browserSocketFactory(url: string): WsLike {
  return new WebSocket(url) as unknown as WsLike;
}

export type PhoneSocketOptions = {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  onMessage: (msg: WsMessage) => void;
  onStatus: (status: WsStatus) => void;
  /** overridable so tests can drive a fake */
  createSocket?: (url: string) => WsLike;
  url?: string;
};

export function connectPhoneSocket(opts: PhoneSocketOptions): WsController {
  return createWsController({
    url: opts.url ?? WS_URL,
    createSocket: opts.createSocket ?? browserSocketFactory,
    getAccessToken: opts.getAccessToken,
    refreshAccessToken: opts.refreshAccessToken,
    onMessage: opts.onMessage,
    onStatus: opts.onStatus,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    random: Math.random,
  });
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/net/__tests__/wsClient.test.ts`
Expected: PASS, 2 tests. The vendored `socket.test.ts` from Task 4 continues to cover the policy itself.

- [ ] **Step 5: Commit**

```bash
git add src/net/wsClient.ts src/net/__tests__/wsClient.test.ts
git commit -m "feat: wire the browser WebSocket into the app's connection policy

The vendored controller takes its socket, timers and jitter source as
dependencies, so backoff, the stable-open reset, the 4401 single-flight
refresh and answering ping with pong are all the app's code running here
unmodified. This module supplies the browser's implementations and nothing
else — there is no second connection policy to keep in step."
```

---

### Task 9: The rolling vitals buffer

This is the mechanism behind "an alert in seconds without touching a threshold": the engine reads a genuine 60-minute series, and changing a vital rewrites its trailing minutes.

**Files:**
- Create: `src/phone/vitalsBuffer.ts`
- Test: `src/phone/__tests__/vitalsBuffer.test.ts`

**Interfaces:**
- Consumes: `VitalReading`, `StepBucket` from `@/phone/vendor/health/vitals`
- Produces: `class VitalsBuffer` with `append(hr: number, atMs: number)`, `setSpo2(pct: number, atMs: number)`, `appendSteps(count: number, fromMs: number, toMs: number)`, `backfillHr(target: number, overMs: number, nowMs: number)`, `hrSeries(): VitalReading[]`, `spo2(): VitalReading | null`, `steps(): StepBucket[]`, `seed(restingHr: number, nowMs: number)`; constants `BUFFER_WINDOW_MS`, `SAMPLE_INTERVAL_MS`, `BACKFILL_MS`

- [ ] **Step 1: Write the failing test**

```ts
// src/phone/__tests__/vitalsBuffer.test.ts
import { describe, expect, it } from 'vitest';
import { assessRisk, RISK_CONFIG } from '@/phone/vendor/health/risk';
import { BACKFILL_MS, BUFFER_WINDOW_MS, VitalsBuffer } from '@/phone/vitalsBuffer';

const NOW = Date.parse('2026-08-09T12:00:00Z');

describe('VitalsBuffer', () => {
  it('evicts samples older than the window', () => {
    const b = new VitalsBuffer();
    b.append(70, NOW - BUFFER_WINDOW_MS - 60_000);
    b.append(72, NOW);
    expect(b.hrSeries()).toHaveLength(1);
  });

  it('keeps samples in ascending time order', () => {
    const b = new VitalsBuffer();
    b.append(70, NOW - 30_000);
    b.append(75, NOW);
    const times = b.hrSeries().map((r) => Date.parse(r.observedAt));
    expect(times).toEqual([...times].sort((a, z) => a - z));
  });

  it('seeds a full window of plausible resting history', () => {
    const b = new VitalsBuffer();
    b.seed(62, NOW);
    const series = b.hrSeries();
    expect(series.length).toBeGreaterThan(10);
    expect(Math.min(...series.map((r) => r.value))).toBeGreaterThan(40);
    expect(Math.max(...series.map((r) => r.value))).toBeLessThan(100);
  });

  it('backfill makes the real engine return danger with no threshold change', () => {
    const b = new VitalsBuffer();
    b.seed(62, NOW);
    // 34-year-old: hrMax = 208 - 0.7*34 = 184.2; danger is > 85% => > 156.6
    b.backfillHr(170, BACKFILL_MS, NOW);

    const assessment = assessRisk({
      hrSeries: b.hrSeries(),
      spo2: b.spo2(),
      steps: b.steps(),
      stepsReadable: true,
      restingHr: 62,
      age: 34,
      nowIso: new Date(NOW).toISOString(),
    });

    expect(assessment.measuredBand).toBe('danger');
    expect(RISK_CONFIG.exertion.dangerPct).toBe(0.85); // unchanged, as promised
  });

  it('backfill covers more than the sustained window the engine requires', () => {
    expect(BACKFILL_MS).toBeGreaterThan(RISK_CONFIG.exertion.sustainedMs);
  });

  it('reports the newest spo2 reading', () => {
    const b = new VitalsBuffer();
    b.setSpo2(97, NOW - 60_000);
    b.setSpo2(93, NOW);
    expect(b.spo2()?.value).toBe(93);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/phone/__tests__/vitalsBuffer.test.ts`
Expected: FAIL — cannot resolve `@/phone/vitalsBuffer`.

- [ ] **Step 3: Implement**

```ts
// src/phone/vitalsBuffer.ts
/**
 * The trailing vitals series one virtual phone's risk engine reads.
 *
 * The engine needs history: `exertion` wants 3 sustained minutes, `load`
 * accumulates over a trailing hour. A real phone gets that by polling a watch
 * every 60 s for an hour. A demo cannot wait, and lowering the thresholds would
 * mean demoing different rules from the product — so the buffer is authored
 * instead: `seed` lays down a plausible hour of resting history at start-up,
 * and `backfillHr` rewrites its trailing minutes when you change a vital.
 *
 * `risk.ts` is then handed a series indistinguishable from a real one and
 * decides with its own unmodified thresholds. The engine is not faked; only the
 * history it reads is authored, which is what a simulator is for.
 */
import type { StepBucket, VitalReading } from '@/phone/vendor/health/vitals';

/** Matches RISK_CONFIG.cumulativeLoad.windowMs, the longest window any rule reads. */
export const BUFFER_WINDOW_MS = 60 * 60_000;

/**
 * Spacing between stored samples. Well inside RISK_CONFIG.series.maxSampleGapMs
 * (5 min), so a sustained run never breaks on a gap, and coarse enough that
 * sixty buffers stay small — 60 min at 15 s is 240 samples each.
 */
export const SAMPLE_INTERVAL_MS = 15_000;

/**
 * How much history a backfill rewrites. Comfortably over
 * RISK_CONFIG.exertion.sustainedMs (3 min) and RISK_CONFIG.restingHr.sustainedMs
 * (10 min), so every sustained rule sees a complete run rather than a partial
 * one that silently fails to fire.
 */
export const BACKFILL_MS = 20 * 60_000;

const iso = (ms: number) => new Date(ms).toISOString();

/** Deterministic ±jitter so a seeded series looks measured, not drawn. */
const jitter = (seed: number, spread: number) =>
  (Math.sin(seed * 12.9898) * 43758.5453 % 1) * spread;

export class VitalsBuffer {
  private hr: VitalReading[] = [];
  private spo2Reading: VitalReading | null = null;
  private stepBuckets: StepBucket[] = [];

  /** Lay down a full window of resting history, so the engine is never cold. */
  seed(restingHr: number, nowMs: number): void {
    this.hr = [];
    for (let t = nowMs - BUFFER_WINDOW_MS; t <= nowMs; t += SAMPLE_INTERVAL_MS) {
      this.hr.push({ value: Math.round(restingHr + jitter(t, 6) - 3), observedAt: iso(t) });
    }
    this.spo2Reading = { value: 98, observedAt: iso(nowMs) };
    this.stepBuckets = [];
  }

  append(value: number, atMs: number): void {
    this.hr.push({ value: Math.round(value), observedAt: iso(atMs) });
    this.evict(atMs);
  }

  setSpo2(pct: number, atMs: number): void {
    this.spo2Reading = { value: pct, observedAt: iso(atMs) };
  }

  appendSteps(count: number, fromMs: number, toMs: number): void {
    if (count <= 0) return;
    this.stepBuckets.push({ startTime: iso(fromMs), endTime: iso(toMs), count });
    const cutoff = toMs - BUFFER_WINDOW_MS;
    this.stepBuckets = this.stepBuckets.filter((b) => Date.parse(b.endTime) >= cutoff);
  }

  /**
   * Rewrite the trailing `overMs` of heart-rate history to `target`, so a
   * sustained rule sees a complete run ending now. Samples older than the
   * window are left alone — the hour before the change really did happen.
   */
  backfillHr(target: number, overMs: number, nowMs: number): void {
    const from = nowMs - overMs;
    this.hr = this.hr.filter((r) => Date.parse(r.observedAt) < from);
    for (let t = from; t <= nowMs; t += SAMPLE_INTERVAL_MS) {
      this.hr.push({ value: Math.round(target + jitter(t, 4) - 2), observedAt: iso(t) });
    }
    this.evict(nowMs);
  }

  hrSeries(): VitalReading[] {
    return this.hr;
  }

  spo2(): VitalReading | null {
    return this.spo2Reading;
  }

  steps(): StepBucket[] {
    return this.stepBuckets;
  }

  private evict(nowMs: number): void {
    const cutoff = nowMs - BUFFER_WINDOW_MS;
    this.hr = this.hr
      .filter((r) => Date.parse(r.observedAt) >= cutoff)
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/phone/__tests__/vitalsBuffer.test.ts`
Expected: PASS, 6 tests. The fourth is the important one — the **real** `assessRisk` returns `danger` from an authored series, with `RISK_CONFIG` untouched.

- [ ] **Step 5: Commit**

```bash
git add src/phone/vitalsBuffer.ts src/phone/__tests__/vitalsBuffer.test.ts
git commit -m "feat: rolling vitals buffer with trailing backfill

How an alert fires in seconds without a threshold moving. The engine needs
history — exertion wants three sustained minutes, load accumulates over an
hour — so the buffer seeds a plausible hour at start-up and rewrites its
trailing twenty minutes when a vital changes. assessRisk is then handed a
series it cannot distinguish from a real one and decides with its own
unmodified config.

The test asserts both halves: the real engine returns danger, and
RISK_CONFIG.exertion.dangerPct is still 0.85."
```

---

### Task 10: The response outbox

**Files:**
- Create: `src/phone/outbox.ts`
- Test: `src/phone/__tests__/outbox.test.ts`

**Interfaces:**
- Consumes: `apiRequest`, `ApiError`, `newClientEventId` (Task 6); `Modality`, `ContextSnapshot` from `@/api/types`
- Produces: `postResponse(token, eventId, body: ResponseBody) → Promise<ResponseResult | 'lost_race'>`, `postIndividualAlert(token, body) → Promise<{ id: string } | null>`, `type ResponseBody`, `type ResponseResult`

- [ ] **Step 1: Write the failing test**

```ts
// src/phone/__tests__/outbox.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/net/apiClient';
import { postResponse } from '@/phone/outbox';

const body = {
  action: 'ack' as const,
  occurred_at: '2026-08-09T12:00:00.000Z',
  modality: { visual: true, haptic: true, sound: false },
  context_snapshot: {},
};

describe('postResponse', () => {
  it('attaches a client_event_id for idempotency', async () => {
    const send = vi.fn(async () => ({ event_id: 'e1', worker_state: 'acknowledged' }));
    await postResponse('tok', 'e1', body, send);
    expect(send.mock.calls[0][2].client_event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the same client_event_id across retries of one action', async () => {
    const ids: string[] = [];
    const send = vi.fn(async (_t: string, _e: string, b: { client_event_id: string }) => {
      ids.push(b.client_event_id);
      if (ids.length === 1) throw new ApiError('network', { status: 0 });
      return { event_id: 'e1', worker_state: 'acknowledged' };
    });

    await postResponse('tok', 'e1', body, send, 2);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('reports a 409 as a lost race rather than throwing', async () => {
    const send = vi.fn(async () => {
      throw new ApiError('resolved', {
        status: 409,
        code: 'event_already_resolved',
        details: { resolved_by: 'w-2' },
      });
    });

    await expect(postResponse('tok', 'e1', body, send)).resolves.toBe('lost_race');
  });

  it('does not retry a 422 — a rejected body will be rejected again', async () => {
    const send = vi.fn(async () => {
      throw new ApiError('bad', { status: 422 });
    });

    await expect(postResponse('tok', 'e1', body, send, 3)).rejects.toBeInstanceOf(ApiError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/phone/__tests__/outbox.test.ts`
Expected: FAIL — cannot resolve `@/phone/outbox`.

- [ ] **Step 3: Implement**

```ts
// src/phone/outbox.ts
/**
 * Everything a virtual phone reports to the server.
 *
 * The contract's idempotency rule is what makes a retry safe: a repeat of a
 * known `client_event_id` is a no-op returning the current state, not a second
 * action. So the key is generated ONCE per action and reused across every
 * retry of it — generating a fresh key per attempt would turn one ack into
 * several distinct audit rows.
 *
 * A 409 is not an error here. It is the state machine working: another worker
 * acked first, this phone lost the race, and the attempt was still recorded.
 */
import { ApiError, apiRequest, newClientEventId } from '@/net/apiClient';
import type { ContextSnapshot, Modality } from '@/api/types';

export type ResponseAction =
  | 'received' | 'popped' | 'ignored_out_of_range' | 'ack' | 'snooze' | 'reject';

export type ResponseBody = {
  action: ResponseAction;
  occurred_at: string;
  snoozed_until?: string;
  distance_m?: number | null;
  modality?: Modality;
  context_snapshot?: ContextSnapshot | Record<string, unknown>;
};

export type ResponseResult = {
  event_id: string;
  worker_state: string;
  event_status?: string;
  resolved_by?: string | null;
};

type SendFn = (
  token: string,
  eventId: string,
  body: ResponseBody & { client_event_id: string },
) => Promise<ResponseResult>;

const realSend: SendFn = (token, eventId, body) =>
  apiRequest<ResponseResult>('POST', `/events/${eventId}/responses`, { token, body });

/** 4xx other than 409 will fail identically on a retry; only transport is worth repeating. */
const worthRetrying = (e: unknown) =>
  !(e instanceof ApiError) || e.status === 0 || e.status >= 500;

export async function postResponse(
  token: string,
  eventId: string,
  body: ResponseBody,
  send: SendFn = realSend,
  attempts = 3,
): Promise<ResponseResult | 'lost_race'> {
  const client_event_id = newClientEventId();
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await send(token, eventId, { ...body, client_event_id });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return 'lost_race';
      if (!worthRetrying(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export type IndividualAlertBody = {
  risk_band: 'caution' | 'danger';
  risk_score: number;
  vitals_snapshot: Record<string, number | null>;
  reason: string;
  raised_at: string;
  decision_trace?: Record<string, unknown>;
};

/**
 * Health alerts are analytics only — the server records the phone's verdict and
 * raises nothing. A failure here must never disturb the demo, so it is
 * swallowed and reported as null rather than thrown into the tick loop.
 */
export async function postIndividualAlert(
  token: string,
  body: IndividualAlertBody,
): Promise<{ id: string } | null> {
  try {
    return await apiRequest<{ id: string }>('POST', '/individual-alerts', {
      token,
      body: { ...body, client_event_id: newClientEventId() },
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/phone/__tests__/outbox.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/phone/outbox.ts src/phone/__tests__/outbox.test.ts
git commit -m "feat: idempotent response and health-alert reporting

One client_event_id per action, reused across every retry of it — the
contract makes a repeat of a known key a no-op returning current state, so
reusing it is what makes a retry safe, while a fresh key per attempt would
turn one ack into several audit rows.

A 409 resolves as 'lost_race' rather than throwing: another worker acked
first, which is the state machine working, and the attempt was recorded
regardless. Only transport and 5xx are retried; a 422 body will be rejected
identically next time."
```

---

### Task 11: The virtual phone

Where the vendored modules are actually driven. This is the file that makes the claim "each phone decides for itself" true.

**Files:**
- Create: `src/phone/VirtualPhone.ts`
- Test: `src/phone/__tests__/VirtualPhone.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-10
- Produces:
  - `type PhoneContext = { position: { x: number; z: number }; floor: string | null; moving: boolean; noiseDbFs: number }`
  - `type PhoneAlert = { event: EventOut; modality: Modality; distanceM: number | null; snapshot: ContextSnapshot; at: number }`
  - `class VirtualPhone` with `handleEvent(event, nowMs)`, `handleResolved(eventId)`, `tickVitals(nowMs)`, `ack(nowMs)`, `snooze(untilMs, nowMs)`, `reject(nowMs)`, `activeAlert: PhoneAlert | null`, `riskBand: RiskBand`
  - `type PhoneDeps = { worker: ProvisionedWorker; anchor: LatLon; getContext: () => PhoneContext; buffer: VitalsBuffer; postResponse: …; postIndividualAlert: … }`

- [ ] **Step 1: Write the failing test**

```ts
// src/phone/__tests__/VirtualPhone.test.ts
import { describe, expect, it, vi } from 'vitest';
import { sceneToLatLon } from '@/runtime/geo';
import { VitalsBuffer } from '@/phone/vitalsBuffer';
import { VirtualPhone } from '@/phone/VirtualPhone';

const ANCHOR = { latitude: 30.04412, longitude: 31.23571 };
const NOW = Date.parse('2026-08-09T12:00:00Z');

const worker = {
  index: 1, userId: 'u-1', username: 'sim-x-w01', email: 'w01@x.io',
  password: 'p', firstName: 'A', lastName: 'B', dateOfBirth: '1992-01-11',
  accessToken: 'tok', refreshToken: 'ref',
};

/** An event 10 m from the scene origin on floor 4, radius 75 m. */
const eventAt = (x: number, z: number, floor: string | null) => ({
  id: 'e-1', source: 'sim', asset_id: 'CHILLER-07', asset_label: 'Chiller 07',
  ...sceneToLatLon(ANCHOR, x, z),
  alert_radius_m: 75, floor, zone_id: null, severity: 'high',
  type: 'ammonia_threshold', message: 'Ammonia threshold exceeded',
  status: 'open', ungated: false, created_at: '2026-08-09T12:00:00Z',
});

const build = (ctx: Partial<{ x: number; z: number; floor: string | null; moving: boolean; noiseDbFs: number }>) => {
  const posted: { action: string; body: unknown }[] = [];
  const buffer = new VitalsBuffer();
  buffer.seed(62, NOW);
  const phone = new VirtualPhone({
    worker,
    anchor: ANCHOR,
    buffer,
    getContext: () => ({
      position: { x: ctx.x ?? 0, z: ctx.z ?? 0 },
      floor: ctx.floor === undefined ? '4' : ctx.floor,
      moving: ctx.moving ?? false,
      noiseDbFs: ctx.noiseDbFs ?? -40,
    }),
    postResponse: async (_t, _e, b) => {
      posted.push({ action: b.action, body: b });
      return { event_id: 'e-1', worker_state: 'received' };
    },
    postIndividualAlert: async () => ({ id: 'ia-1' }),
  });
  return { phone, posted, buffer };
};

describe('VirtualPhone — group alerts', () => {
  it('pops for a worker on the same floor and inside the radius', async () => {
    const { phone, posted } = build({ x: 5, z: 5, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert).not.toBeNull();
    expect(posted.map((p) => p.action)).toContain('popped');
  });

  it('ignores a worker on a different floor and reports it', async () => {
    const { phone, posted } = build({ x: 5, z: 5, floor: '2' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert).toBeNull();
    expect(posted.map((p) => p.action)).toContain('ignored_out_of_range');
  });

  it('ignores a worker beyond the radius', async () => {
    const { phone, posted } = build({ x: 400, z: 0, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert).toBeNull();
    expect(posted.map((p) => p.action)).toContain('ignored_out_of_range');
  });

  it('suppresses sound in loud noise and visual while moving', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4', moving: true, noiseDbFs: -10 });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert?.modality).toEqual({ visual: false, haptic: true, sound: false });
  });

  it('fires all three channels when still and quiet — haptic is never suppressed', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4', moving: false, noiseDbFs: -60 });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert?.modality).toEqual({ visual: true, haptic: true, sound: true });
  });

  it('clears the alert when the server resolves the event', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    phone.handleResolved('e-1');

    expect(phone.activeAlert).toBeNull();
  });

  it('ignores a duplicate delivery of the same event', async () => {
    const { phone, posted } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    await phone.handleEvent(eventAt(0, 0, '4'), NOW + 500);

    expect(posted.filter((p) => p.action === 'popped')).toHaveLength(1);
  });

  it('posts an ack and clears', async () => {
    const { phone, posted } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    await phone.ack(NOW + 4_000);

    expect(posted.map((p) => p.action)).toContain('ack');
    expect(phone.activeAlert).toBeNull();
  });
});

describe('VirtualPhone — health alerts', () => {
  it('raises a danger alert on the first tick after a backfill', async () => {
    const raised = vi.fn(async () => ({ id: 'ia-1' }));
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker,
      anchor: ANCHOR,
      buffer,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '4', moving: false, noiseDbFs: -40,
      }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
      postIndividualAlert: raised,
    });

    buffer.backfillHr(175, 20 * 60_000, NOW);
    await phone.tickVitals(NOW);

    expect(phone.riskBand).toBe('danger');
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('does not raise twice for one episode', async () => {
    const raised = vi.fn(async () => ({ id: 'ia-1' }));
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker, anchor: ANCHOR, buffer,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '4', moving: false, noiseDbFs: -40,
      }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
      postIndividualAlert: raised,
    });

    buffer.backfillHr(175, 20 * 60_000, NOW);
    await phone.tickVitals(NOW);
    await phone.tickVitals(NOW + 2_000);

    expect(raised).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/phone/__tests__/VirtualPhone.test.ts`
Expected: FAIL — cannot resolve `@/phone/VirtualPhone`.

- [ ] **Step 3: Implement**

```ts
// src/phone/VirtualPhone.ts
/**
 * One simulated worker's phone.
 *
 * Every decision here is made by a vendored module, exactly as it is on a real
 * handset: `decideProximity` gates the alert, `decideModality` picks the
 * channels, `assessRisk` and `nextAlertState` drive health alerts. This class
 * is only the wiring — it gathers inputs, calls the app's code, and reports the
 * verdict. Nothing in it may decide anything itself.
 *
 * The scene is never read directly. `getContext` is the seam: the runtime
 * supplies position, floor, movement and ambient noise, and the phone neither
 * knows nor cares that they come from a 3D agent.
 */
import type { ContextSnapshot, EventOut, Modality, RiskBand } from '@/api/types';
import { ALERT_CONFIG, INITIAL_LATCH, nextAlertState, type AlertLatchState } from '@/phone/vendor/health/alerting';
import { assessRisk, ageFromDob } from '@/phone/vendor/health/risk';
import { classifyContext } from '@/phone/vendor/context/ambientContext';
import { decideModality } from '@/phone/vendor/context/modality';
import { decideProximity, proximityContextSnapshot } from '@/phone/vendor/realtime/proximity';
import type { LatLon } from '@/runtime/geo';
import { sceneToLatLon } from '@/runtime/geo';
import type { ProvisionedWorker } from '@/net/provisioning';
import type { IndividualAlertBody, ResponseBody, ResponseResult } from '@/phone/outbox';
import type { VitalsBuffer } from '@/phone/vitalsBuffer';

export type PhoneContext = {
  position: { x: number; z: number };
  floor: string | null;
  moving: boolean;
  /** ambient level in dBFS — negative, compared against NOISE_CONFIG.loudThresholdDbFs */
  noiseDbFs: number;
};

export type PhoneAlert = {
  event: EventOut;
  modality: Modality;
  distanceM: number | null;
  snapshot: ContextSnapshot;
  at: number;
};

export type PhoneDeps = {
  worker: ProvisionedWorker;
  anchor: LatLon;
  buffer: VitalsBuffer;
  getContext: () => PhoneContext;
  postResponse: (
    token: string,
    eventId: string,
    body: ResponseBody,
  ) => Promise<ResponseResult | 'lost_race'>;
  postIndividualAlert: (
    token: string,
    body: IndividualAlertBody,
  ) => Promise<{ id: string } | null>;
};

export class VirtualPhone {
  activeAlert: PhoneAlert | null = null;
  riskBand: RiskBand = 'normal';

  private readonly deps: PhoneDeps;
  private readonly seen = new Set<string>();
  private latch: AlertLatchState = INITIAL_LATCH;
  private restingHr: number | null = null;

  constructor(deps: PhoneDeps) {
    this.deps = deps;
  }

  get workerId(): string {
    return this.deps.worker.userId;
  }

  /** Estimated resting HR, which the stress rule needs; set by the fleet at seed time. */
  setRestingHr(bpm: number): void {
    this.restingHr = bpm;
  }

  /**
   * A group alert arrived. The gate runs here, on this phone, with this
   * worker's own floor and position — which is the entire architecture in one
   * method.
   */
  async handleEvent(event: EventOut, nowMs: number): Promise<void> {
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);

    const ctx = this.deps.getContext();
    const fix = sceneToLatLon(this.deps.anchor, ctx.position.x, ctx.position.z);

    const input = {
      event: {
        floor: event.floor,
        latitude: event.latitude,
        longitude: event.longitude,
        alertRadiusM: event.alert_radius_m,
      },
      workerFloor: ctx.floor,
      gps: { latitude: fix.latitude, longitude: fix.longitude, timestamp: nowMs },
      nowMs,
    };

    const verdict = decideProximity(input);
    const snapshot = proximityContextSnapshot(input, verdict);

    if (!verdict.shouldPop) {
      await this.report(event.id, {
        action: 'ignored_out_of_range',
        occurred_at: new Date(nowMs).toISOString(),
        distance_m: verdict.distanceM,
        context_snapshot: snapshot,
      });
      return;
    }

    const modality = decideModality(
      classifyContext({
        motion: { stepsReadable: true, hasSteps: ctx.moving, at: nowMs },
        noise: { dbFs: ctx.noiseDbFs, ageMs: 0 },
      }),
    );

    this.activeAlert = {
      event, modality, distanceM: verdict.distanceM, snapshot, at: nowMs,
    };

    await this.report(event.id, {
      action: 'popped',
      occurred_at: new Date(nowMs).toISOString(),
      distance_m: verdict.distanceM,
      modality,
      context_snapshot: snapshot,
    });
  }

  /** The server resolved the event — clear without asking anything locally. */
  handleResolved(eventId: string): void {
    if (this.activeAlert?.event.id === eventId) this.activeAlert = null;
  }

  /** A snooze expired server-side; the alert returns. No local timer exists. */
  async handleReminder(event: EventOut, nowMs: number): Promise<void> {
    this.seen.delete(event.id);
    await this.handleEvent(event, nowMs);
  }

  async ack(nowMs: number): Promise<void> {
    await this.decide('ack', nowMs);
  }

  async reject(nowMs: number): Promise<void> {
    await this.decide('reject', nowMs);
  }

  async snooze(untilMs: number, nowMs: number): Promise<void> {
    const alert = this.activeAlert;
    if (!alert) return;
    this.activeAlert = null;
    await this.report(alert.event.id, {
      action: 'snooze',
      occurred_at: new Date(nowMs).toISOString(),
      snoozed_until: new Date(untilMs).toISOString(),
    });
  }

  /**
   * One poll of the health engine. The app runs this every 60 s; the simulator
   * runs it every couple of seconds against the same unmodified thresholds.
   */
  async tickVitals(nowMs: number): Promise<void> {
    const nowIso = new Date(nowMs).toISOString();
    const assessment = assessRisk({
      hrSeries: this.deps.buffer.hrSeries(),
      spo2: this.deps.buffer.spo2(),
      steps: this.deps.buffer.steps(),
      stepsReadable: true,
      restingHr: this.restingHr,
      age: ageFromDob(this.deps.worker.dateOfBirth, nowIso),
      nowIso,
    });

    this.riskBand = assessment.band;

    const tick = nextAlertState(this.latch, assessment);
    this.latch = tick.state;
    if (tick.raise === null) return;

    await this.deps.postIndividualAlert(this.deps.worker.accessToken, {
      risk_band: tick.raise,
      risk_score: assessment.score,
      vitals_snapshot: {
        hr: assessment.snapshot.hr,
        resting_hr_est: assessment.snapshot.restingHr,
        pct_hrmax: assessment.snapshot.pctHrMax,
        spo2: assessment.snapshot.spo2,
        steps_last_min: assessment.snapshot.stepsLastMin,
        sustained_s: assessment.snapshot.sustainedS,
      },
      reason: assessment.reason,
      raised_at: nowIso,
      decision_trace: {
        engine: 'risk-v1',
        rules: assessment.rules,
        debounce: {
          qualifying_polls: 1,
          required_polls: ALERT_CONFIG.enterTicks[tick.raise],
          poll_interval_s: 2,
        },
      },
    });
  }

  private async decide(action: 'ack' | 'reject', nowMs: number): Promise<void> {
    const alert = this.activeAlert;
    if (!alert) return;
    this.activeAlert = null;
    await this.report(alert.event.id, {
      action,
      occurred_at: new Date(nowMs).toISOString(),
    });
  }

  private async report(eventId: string, body: ResponseBody): Promise<void> {
    await this.deps.postResponse(this.deps.worker.accessToken, eventId, body);
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/phone/__tests__/VirtualPhone.test.ts`
Expected: PASS, 10 tests. Note the fifth: `still + quiet` yields all three channels, which is the resolved modality divergence asserted rather than assumed.

- [ ] **Step 5: Commit**

```bash
git add src/phone/VirtualPhone.ts src/phone/__tests__/VirtualPhone.test.ts
git commit -m "feat: the virtual phone — vendored decisions, simulator wiring

Every decision belongs to a vendored module: decideProximity gates the
alert with this worker's own floor and position, decideModality picks the
channels, assessRisk and nextAlertState drive health alerts. This class
gathers inputs, calls the app's code and reports the verdict, and is not
permitted to decide anything itself.

getContext is the seam that keeps the phone from reading the scene: the
runtime hands it position, floor, movement and ambient noise, and the phone
never learns they came from a 3D agent.

The still+quiet test pins the resolved modality divergence — all three
channels, because haptic is a safety floor and is never suppressed."
```

---

### Task 12: The fleet and its scheduler

**Files:**
- Create: `src/runtime/scheduler.ts`, `src/runtime/fleet.ts`
- Test: `src/runtime/__tests__/scheduler.test.ts`, `src/runtime/__tests__/fleet.test.ts`

**Interfaces:**
- Consumes: Tasks 5-11
- Produces: `createStaggeredScheduler({ count, intervalMs, onTick, setTimeout?, clearTimeout? }) → { start(): void; stop(): void }`; `class Fleet` with `start(session, count, anchor, getContext)`, `stop()`, `phones: VirtualPhone[]`, `phoneFor(index)`, `connectedCount`

- [ ] **Step 1: Write the scheduler's failing test**

```ts
// src/runtime/__tests__/scheduler.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createStaggeredScheduler } from '@/runtime/scheduler';

describe('createStaggeredScheduler', () => {
  it('ticks every member once per interval', () => {
    vi.useFakeTimers();
    const ticked: number[] = [];
    const s = createStaggeredScheduler({
      count: 4, intervalMs: 2000, onTick: (i) => ticked.push(i),
    });

    s.start();
    vi.advanceTimersByTime(2000);

    expect([...ticked].sort()).toEqual([0, 1, 2, 3]);
    s.stop();
    vi.useRealTimers();
  });

  it('spreads ticks across the interval rather than bunching them', () => {
    vi.useFakeTimers();
    const at: Record<number, number> = {};
    let clock = 0;
    const s = createStaggeredScheduler({
      count: 4,
      intervalMs: 2000,
      onTick: (i) => { at[i] = clock; },
    });

    s.start();
    for (let step = 0; step < 4; step++) {
      clock += 500;
      vi.advanceTimersByTime(500);
    }

    expect(new Set(Object.values(at)).size).toBeGreaterThan(1);
    s.stop();
    vi.useRealTimers();
  });

  it('stops cleanly', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const s = createStaggeredScheduler({ count: 2, intervalMs: 1000, onTick });

    s.start();
    s.stop();
    vi.advanceTimersByTime(5000);

    expect(onTick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/runtime/__tests__/scheduler.test.ts`
Expected: FAIL — cannot resolve `@/runtime/scheduler`.

- [ ] **Step 3: Implement the scheduler**

```ts
// src/runtime/scheduler.ts
/**
 * Ticks the fleet without bunching.
 *
 * Sixty risk assessments in one frame is a visible hitch; sixty spread across
 * the interval is invisible. Each member gets its own slot, so the work per
 * frame is one assessment rather than sixty.
 *
 * The tick callback is deliberately fire-and-forget: a phone's POST must never
 * hold up the next phone's assessment.
 */
export type StaggeredScheduler = { start(): void; stop(): void };

export function createStaggeredScheduler(opts: {
  count: number;
  intervalMs: number;
  onTick: (index: number) => void;
}): StaggeredScheduler {
  const { count, intervalMs, onTick } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;
  let cursor = 0;

  // One slot per member: with 60 members on a 2 s interval, a slot every ~33 ms.
  const slotMs = Math.max(1, Math.floor(intervalMs / Math.max(1, count)));

  return {
    start() {
      if (timer !== null || count === 0) return;
      timer = setInterval(() => {
        onTick(cursor % count);
        cursor++;
      }, slotMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      cursor = 0;
    },
  };
}
```

- [ ] **Step 4: Run the scheduler test**

Run: `npx vitest run src/runtime/__tests__/scheduler.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the fleet's failing test**

```ts
// src/runtime/__tests__/fleet.test.ts
import { describe, expect, it } from 'vitest';
import { Fleet } from '@/runtime/fleet';

const ANCHOR = { latitude: 30.04412, longitude: 31.23571 };

const worker = (index: number) => ({
  index, userId: `u-${index}`, username: `w${index}`, email: `w${index}@x.io`,
  password: 'p', firstName: 'A', lastName: 'B', dateOfBirth: '1992-01-11',
  accessToken: `tok-${index}`, refreshToken: 'ref',
});

const session = {
  slug: 's', companyId: 'c', companyName: 'Demo', adminUserId: 'a',
  adminAccessToken: 'admin', adminRefreshToken: 'ar', joinCode: 'X',
};

describe('Fleet', () => {
  it('creates one phone per provisioned worker', () => {
    const fleet = new Fleet({
      anchor: ANCHOR,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
      }),
      connect: () => ({ start() {}, stop() {}, kick() {} }),
    });

    fleet.start(session, [worker(1), worker(2), worker(3)]);

    expect(fleet.phones).toHaveLength(3);
    expect(fleet.phoneFor(2)?.workerId).toBe('u-2');
    fleet.stop();
  });

  it('opens one socket per worker and closes them all on stop', () => {
    let opened = 0;
    let stopped = 0;
    const fleet = new Fleet({
      anchor: ANCHOR,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
      }),
      connect: () => {
        opened++;
        return { start() {}, stop() { stopped++; }, kick() {} };
      },
    });

    fleet.start(session, [worker(1), worker(2)]);
    expect(opened).toBe(2);

    fleet.stop();
    expect(stopped).toBe(2);
    expect(fleet.phones).toHaveLength(0);
  });

  it('routes an event to every phone', async () => {
    const fleet = new Fleet({
      anchor: ANCHOR,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
      }),
      connect: () => ({ start() {}, stop() {}, kick() {} }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
    });

    fleet.start(session, [worker(1), worker(2)]);
    await fleet.deliverToAll(
      {
        id: 'e-1', source: 'sim', asset_id: 'A', asset_label: 'A',
        latitude: ANCHOR.latitude, longitude: ANCHOR.longitude, alert_radius_m: 75,
        floor: null, zone_id: null, severity: 'high', type: 't', message: 'm',
        status: 'open', ungated: false, created_at: '2026-08-09T12:00:00Z',
      },
      Date.now(),
    );

    expect(fleet.phones.every((p) => p.activeAlert !== null)).toBe(true);
    fleet.stop();
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run src/runtime/__tests__/fleet.test.ts`
Expected: FAIL — cannot resolve `@/runtime/fleet`.

- [ ] **Step 7: Implement the fleet**

```ts
// src/runtime/fleet.ts
/**
 * Every virtual phone in the demo, and their sockets.
 *
 * The fleet does NOT fan events out itself — each phone holds its own
 * WebSocket and receives the server's own broadcast. `deliverToAll` exists for
 * tests and for the one case where the simulator legitimately drives every
 * phone at once; it is not the production delivery path, and using it as one
 * would quietly turn sixty independent clients back into a single fake.
 */
import type { EventOut, WsMessage } from '@/api/types';
import type { ProvisionedSession, ProvisionedWorker } from '@/net/provisioning';
import { connectPhoneSocket } from '@/net/wsClient';
import { postIndividualAlert, postResponse } from '@/phone/outbox';
import type { IndividualAlertBody, ResponseBody, ResponseResult } from '@/phone/outbox';
import { VirtualPhone, type PhoneContext } from '@/phone/VirtualPhone';
import { VitalsBuffer } from '@/phone/vitalsBuffer';
import type { LatLon } from '@/runtime/geo';
import { createStaggeredScheduler, type StaggeredScheduler } from '@/runtime/scheduler';

/** A resting heart rate for each worker, so the stress rule has a baseline. */
const RESTING_HR_BASE = 58;

type SocketHandle = { start(): void; stop(): void; kick(): void };

export type FleetDeps = {
  anchor: LatLon;
  /** per-worker scene context; the runtime replaces this once agents exist */
  getContext: (worker: ProvisionedWorker) => PhoneContext;
  connect?: (worker: ProvisionedWorker, onMessage: (m: WsMessage) => void) => SocketHandle;
  postResponse?: (
    token: string, eventId: string, body: ResponseBody,
  ) => Promise<ResponseResult | 'lost_race'>;
  postIndividualAlert?: (
    token: string, body: IndividualAlertBody,
  ) => Promise<{ id: string } | null>;
  vitalsTickMs?: number;
};

export class Fleet {
  phones: VirtualPhone[] = [];

  private readonly deps: FleetDeps;
  private sockets: SocketHandle[] = [];
  private buffers: VitalsBuffer[] = [];
  private scheduler: StaggeredScheduler | null = null;
  private byIndex = new Map<number, VirtualPhone>();

  constructor(deps: FleetDeps) {
    this.deps = deps;
  }

  get connectedCount(): number {
    return this.sockets.length;
  }

  buffer(index: number): VitalsBuffer | undefined {
    const at = this.phones.findIndex((p) => this.byIndex.get(index) === p);
    return at >= 0 ? this.buffers[at] : undefined;
  }

  phoneFor(index: number): VirtualPhone | undefined {
    return this.byIndex.get(index);
  }

  start(_session: ProvisionedSession, workers: ProvisionedWorker[]): void {
    const now = Date.now();

    for (const worker of workers) {
      const buffer = new VitalsBuffer();
      // Resting HR varies a little per worker so the stress rule's delta is
      // personal rather than shared.
      const resting = RESTING_HR_BASE + (worker.index % 12);
      buffer.seed(resting, now);

      const phone = new VirtualPhone({
        worker,
        anchor: this.deps.anchor,
        buffer,
        getContext: () => this.deps.getContext(worker),
        postResponse: this.deps.postResponse ?? postResponse,
        postIndividualAlert: this.deps.postIndividualAlert ?? postIndividualAlert,
      });
      phone.setRestingHr(resting);

      const socket =
        this.deps.connect?.(worker, (msg) => void this.route(phone, msg)) ??
        connectPhoneSocket({
          getAccessToken: () => worker.accessToken,
          refreshAccessToken: async () => worker.accessToken,
          onMessage: (msg) => void this.route(phone, msg),
          onStatus: () => {},
        });
      socket.start();

      this.phones.push(phone);
      this.buffers.push(buffer);
      this.sockets.push(socket);
      this.byIndex.set(worker.index, phone);
    }

    this.scheduler = createStaggeredScheduler({
      count: this.phones.length,
      intervalMs: this.deps.vitalsTickMs ?? 2_000,
      onTick: (i) => void this.phones[i]?.tickVitals(Date.now()),
    });
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler?.stop();
    this.scheduler = null;
    for (const s of this.sockets) s.stop();
    this.sockets = [];
    this.phones = [];
    this.buffers = [];
    this.byIndex.clear();
  }

  /** Test/utility path only — production delivery is each phone's own socket. */
  async deliverToAll(event: EventOut, nowMs: number): Promise<void> {
    await Promise.all(this.phones.map((p) => p.handleEvent(event, nowMs)));
  }

  private async route(phone: VirtualPhone, msg: WsMessage): Promise<void> {
    const now = Date.now();
    if (msg.type === 'event') await phone.handleEvent(msg.event as EventOut, now);
    else if (msg.type === 'event_resolved') phone.handleResolved(msg.event_id as string);
    else if (msg.type === 'event_reminder') {
      await phone.handleReminder(msg.event as EventOut, now);
    }
  }
}
```

- [ ] **Step 8: Run the fleet test**

Run: `npx vitest run src/runtime/__tests__/fleet.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add src/runtime/scheduler.ts src/runtime/fleet.ts src/runtime/__tests__
git commit -m "feat: the fleet and its staggered scheduler

Sixty phones, each with its own socket receiving the server's own broadcast
— the fleet deliberately does not fan events out itself, because doing so
would quietly turn sixty independent clients back into one fake. The
deliverToAll path exists for tests and says so.

Ticks are staggered across the interval rather than run together: sixty risk
assessments in one frame is a visible hitch, one per frame is invisible.
Resting heart rate varies per worker so the stress rule's delta is personal
rather than a shared constant."
```

---

### Task 13: Setup screen and reset

**Files:**
- Create: `src/ui/SetupScreen.tsx`, `src/ui/setupState.ts`
- Modify: `src/App.tsx`
- Test: `src/ui/__tests__/setupState.test.ts`

**Interfaces:**
- Consumes: Tasks 7 and 12
- Produces: `type SetupPhase = 'idle' | 'company' | 'workers' | 'connecting' | 'ready' | 'failed'`; `useSetupStore` (Zustand) with `phase`, `progress: { done: number; total: number }`, `error: string | null`, `workerCount`, `site`, `start()`, `retry()`, `reset()`

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/__tests__/setupState.test.ts
import { describe, expect, it } from 'vitest';
import { nextPhaseAfterFailure, progressLabel, resumeFromIndex } from '@/ui/setupState';

describe('setup state helpers', () => {
  it('labels progress readably', () => {
    expect(progressLabel('workers', { done: 24, total: 60 })).toBe('Registering workers 24 / 60');
    expect(progressLabel('company', { done: 0, total: 60 })).toBe('Creating the company');
    expect(progressLabel('connecting', { done: 60, total: 60 })).toBe('Connecting 60 phones');
  });

  it('resumes worker registration from what already succeeded', () => {
    expect(resumeFromIndex({ done: 24, total: 60 })).toBe(24);
  });

  it('never resumes past the total', () => {
    expect(resumeFromIndex({ done: 60, total: 60 })).toBe(60);
  });

  it('a company-phase failure restarts from scratch, a worker-phase one resumes', () => {
    expect(nextPhaseAfterFailure('company')).toBe('idle');
    expect(nextPhaseAfterFailure('workers')).toBe('workers');
    expect(nextPhaseAfterFailure('connecting')).toBe('connecting');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/ui/__tests__/setupState.test.ts`
Expected: FAIL — cannot resolve `@/ui/setupState`.

- [ ] **Step 3: Implement the helpers**

```ts
// src/ui/setupState.ts
/**
 * The pure half of the setup flow, so the retry rules are testable without a
 * React tree.
 *
 * Resuming matters because registration is the long step: a failure at worker
 * 41 of 60 must retry nineteen registrations, not sixty — the first
 * forty-one would come back 409 (the identifiers are already taken) and the
 * session would be unrecoverable.
 */
export type SetupPhase = 'idle' | 'company' | 'workers' | 'connecting' | 'ready' | 'failed';

export type SetupProgress = { done: number; total: number };

export function progressLabel(phase: SetupPhase, progress: SetupProgress): string {
  switch (phase) {
    case 'company':
      return 'Creating the company';
    case 'workers':
      return `Registering workers ${progress.done} / ${progress.total}`;
    case 'connecting':
      return `Connecting ${progress.total} phones`;
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Setup failed';
    default:
      return 'Idle';
  }
}

/** Registration resumes after the last worker that actually landed. */
export function resumeFromIndex(progress: SetupProgress): number {
  return Math.min(progress.done, progress.total);
}

/**
 * A company-phase failure leaves nothing to resume — the tenant may not exist —
 * so it restarts. Later phases keep what they have.
 */
export function nextPhaseAfterFailure(phase: SetupPhase): SetupPhase {
  return phase === 'company' ? 'idle' : phase;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/ui/__tests__/setupState.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the setup screen**

```tsx
// src/ui/SetupScreen.tsx
/**
 * The gate in front of the scene.
 *
 * Provisioning writes sixty accounts to a shared production server, so it never
 * happens on page load — it happens when someone presses Start. A stray refresh
 * costing another dead company is exactly the failure this prevents.
 */
import { useCallback, useState } from 'react';
import {
  newSessionSlug,
  provisionCompany,
  provisionWorkers,
  type ProvisionedSession,
  type ProvisionedWorker,
} from '@/net/provisioning';
import {
  nextPhaseAfterFailure,
  progressLabel,
  resumeFromIndex,
  type SetupPhase,
  type SetupProgress,
} from '@/ui/setupState';

export type SetupResult = { session: ProvisionedSession; workers: ProvisionedWorker[] };

export function SetupScreen({ onReady }: { onReady: (result: SetupResult) => void }) {
  const [phase, setPhase] = useState<SetupPhase>('idle');
  const [progress, setProgress] = useState<SetupProgress>({ done: 0, total: 60 });
  const [workerCount, setWorkerCount] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ProvisionedSession | null>(null);

  const run = useCallback(async () => {
    setError(null);
    try {
      let active = session;
      if (!active) {
        setPhase('company');
        setProgress({ done: 0, total: workerCount });
        active = await provisionCompany(newSessionSlug(), 'Factory');
        setSession(active);
      }

      setPhase('workers');
      const from = resumeFromIndex({ done: progress.done, total: workerCount });
      const workers = await provisionWorkers(active, workerCount, (done, total) =>
        setProgress({ done, total }), undefined, from);

      setPhase('connecting');
      onReady({ session: active, workers });
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase((p) => nextPhaseAfterFailure(p));
    }
  }, [session, workerCount, progress.done, onReady]);

  const busy = phase !== 'idle' && phase !== 'ready' && error === null;

  return (
    <div className="setup">
      <h1>Twelve Senses — Demo Simulator</h1>

      <label>
        Workers
        <input
          type="number"
          min={1}
          max={120}
          value={workerCount}
          disabled={busy}
          onChange={(e) => setWorkerCount(Number(e.target.value))}
        />
      </label>

      <button disabled={busy} onClick={() => void run()}>
        {error ? 'Retry' : busy ? 'Working…' : 'Start'}
      </button>

      {phase !== 'idle' && (
        <p className="setup-progress">{progressLabel(phase, progress)}</p>
      )}
      {error && <p className="setup-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Wire it into `App.tsx`**

At the top of `src/App.tsx`, add the imports:

```tsx
import { Fleet } from '@/runtime/fleet';
import { SetupScreen, type SetupResult } from '@/ui/SetupScreen';
```

Inside the `App` component, before the existing `return`, add:

```tsx
  const [fleet, setFleet] = useState<Fleet | null>(null);

  // Phase 1 renders the existing scene; the fleet is real and headless behind
  // it. Agents feed real positions in Phase 2 — until then every phone reports
  // the scene origin on floor 1, which is enough to prove the round trip.
  const onReady = useCallback((result: SetupResult) => {
    const next = new Fleet({
      anchor: { latitude: 30.04412, longitude: 31.23571 },
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
      }),
    });
    next.start(result.session, result.workers);
    setFleet(next);
  }, []);

  if (!fleet) return <SetupScreen onReady={onReady} />;
```

- [ ] **Step 7: Verify the build**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run test:run`
Expected: no TypeScript errors; every test passes.

- [ ] **Step 8: Commit**

```bash
git add src/ui src/App.tsx
git commit -m "feat: setup screen gating provisioning behind an explicit Start

Provisioning writes sixty accounts to a shared production server, so it must
never happen on page load — a stray refresh costing another dead company is
precisely the failure this prevents.

Retry resumes from the worker count that actually landed: a failure at 41 of
60 must register nineteen, because re-registering the first forty-one would
return 409 on identifiers already taken and leave the session unrecoverable.
A company-phase failure is the exception and restarts, since there may be no
tenant to resume into."
```

---

### Task 14: End-to-end verification against the live server

The phase is only done when the round trip is observed, not asserted.

**Files:**
- Create: `docs/phase-1-verification.md`

**Interfaces:**
- Consumes: everything
- Produces: a recorded verification result

- [ ] **Step 1: Run the app**

Run: `npm run dev`
Open the printed URL, set Workers to **6** for the first run (a small fleet is easier to read in the network panel), and press Start.

- [ ] **Step 2: Confirm provisioning**

In DevTools → Network, expect: one `POST /api/v1/companies/register` → 201, one `POST /api/v1/enrollment-codes` → 201, six `POST /api/v1/auth/register` → 201, never more than 8 in flight.

- [ ] **Step 3: Confirm the sockets**

In DevTools → Network → WS, expect **six** open connections to `/api/v1/ws?token=…`, each receiving a `{"type":"ping"}` about every 20 s and replying `{"type":"pong"}`. A socket closing every ~40 s means pong replies are not being sent.

- [ ] **Step 4: Raise a real alert and watch the fan-out**

In the DevTools console, using the admin token from the setup result:

```js
await fetch('/api/v1/simulations/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
  body: JSON.stringify({ asset_id: 'CHILLER-07', severity: 'critical', floor: null }),
}).then((r) => r.json());
```

Expected: `201` with `seeded` equal to the worker count. Every socket receives one `{"type":"event"}` frame, and six `POST /events/{id}/responses` follow with `action: "popped"` (the event is unfloored and every phone reports the origin, so all six are in range — that is correct, not a bug).

- [ ] **Step 5: Confirm the ack cutoff**

In the console, ack as the first worker:

```js
await fetch(`/api/v1/events/${EVENT_ID}/responses`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WORKER_1_TOKEN}` },
  body: JSON.stringify({
    client_event_id: crypto.randomUUID(), action: 'ack',
    occurred_at: new Date().toISOString(),
  }),
}).then((r) => r.json());
```

Expected: `200` with `event_status: "resolved"`, and **the other five sockets each receive one `event_resolved` frame**. That message clearing the other phones — rather than any local code — is the single most important thing this phase proves.

- [ ] **Step 6: Confirm the numbers server-side**

```js
await fetch(`/api/v1/events/${EVENT_ID}`, {
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
}).then((r) => r.json());
```

Expected: `tracked` equal to the worker count, `counts.popped` matching the phones that popped, `counts.ack` of 1, and a non-null `ack_latency_s`.

- [ ] **Step 7: Repeat at 60 workers**

Reset, set Workers to 60, and repeat steps 2-6. Expect 60 sockets, `seeded: 60`, and no dropped connections over five minutes.

- [ ] **Step 8: Record the result**

Write `docs/phase-1-verification.md` with the date, the server commit, the worker counts tested, the actual `seeded` / `tracked` / `counts` values observed, and anything that did not behave as expected.

- [ ] **Step 9: Commit**

```bash
git add docs/phase-1-verification.md
git commit -m "docs: record the Phase 1 end-to-end verification

The round trip observed rather than asserted: provisioning, sixty live
sockets, a real simulated alert fanning out, sixty independent proximity
decisions reported back, and an ack resolving the event so the server's own
event_resolved frame clears the other phones. That last part — the other
phones clearing on the server's message and not on local code — is what the
whole phase exists to prove."
```

---

## Self-Review

**Spec coverage.** Design §4.2 fleet → Tasks 11, 12. §4.3 vendoring → Task 4. §4.4 modality resolution → Task 4 (deletes the old table) and Task 11 (asserts the row). §4.5 geo → Task 5. §4.6 timing → Task 9. §4.7 provisioning and reset → Tasks 7, 13. §3.1 CORS → Task 2. §3.3 registration constraints → Tasks 1, 7. §9 error handling → Tasks 6, 10, 13. §10 testing → every task.

**Not in this phase, by design:** §5 sites, §6 worker AI, §7 visual work and §8 interaction are Phases 2-4. Physiology (`phone/physiology.ts`) is listed in the design's file structure but belongs with the agents that drive it, so it moves to Phase 2; the buffer it will write into exists here.

**One deletion the plan must not forget:** `src/logic/routing.ts` and `src/logic/routing.test.ts` are superseded by the vendored `modality.ts` (design §4.4). They are removed in Phase 2, when the scene stops importing them — removing them here would break the existing `store.ts` while it is still the running app.

**Type consistency.** `ProvisionedWorker` (Task 7) is consumed unchanged by Tasks 11 and 12. `PhoneContext` is defined in Task 11 and imported by Task 12. `ResponseBody` / `ResponseResult` / `IndividualAlertBody` are defined in Task 10 and consumed by Tasks 11 and 12. `LatLon` is defined in Task 5 and used in Tasks 11 and 12. `VitalsBuffer`'s methods match between Tasks 9, 11 and 12.
