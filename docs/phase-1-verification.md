# Phase 1 — end-to-end verification against the live deployment

**Date:** 2026-08-09
**Server:** `https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws`
**Simulator branch:** `feat/phase-1-virtual-phone-fleet`
**Unit suite at time of verification:** 372 passing, 22 files, 0 skipped

## What was verified

The phase's claim is that each simulated worker is a real client — its own account,
its own WebSocket, and the mobile app's own decision modules — rather than a
central script pretending to be sixty phones. That is only provable against the
real server, so the verification ran the actual modules (`provisionCompany`,
`provisionWorkers`, `Fleet`, `VirtualPhone`) over real sockets.

Run at 6 workers first, then at 60.

## Result — 60 workers

```
provisioning        60/60 registered in 21.4s, 0 failures
POST /simulations/events
                 -> 201 {inserted: true, delivered: 60, pushed: 0, seeded: 60}
fan-out             60 of 60 phones popped, each deciding independently
modality            still + quiet -> {visual: true, haptic: true, sound: true}
ack                 worker 1 acked
cut-off             other phones still showing the alert: 0 of 59
counts.received     settled at 60 of 60
GET /events/{id} -> {status: "resolved", tracked: 60,
                     counts: {received: 60, ack: 1, snooze: 0, reject: 0},
                     ack_latency_s: 4}
report errors       0 of 60 phones carried a lastReportError
POST /companies/me/purge
                 -> {events: 1, event_responses: 60, response_events: 180,
                     individual_alerts: 0, individual_alert_events: 0,
                     devices: 0, enrollment_codes: 1, workers: 60}
```

`response_events: 180` reconciles exactly: 60 `received` + 60 `popped` + 1 `ack`
+ 59 `auto_cancelled`.

## The three things that mattered

**The cut-off is the server's, not ours.** Fifty-nine phones cleared because the
server broadcast `event_resolved` and each acted on it independently. No
simulator code told them to. This is the single claim the phase existed to
establish.

**The modality row is the app's, not the old simulator's.** `still + quiet` fired
all three channels. The superseded `12sense-sim/logic/routing.ts` suppressed
haptic in that case; the shipped app does not, because haptic is an on-body
safety floor. The demo now behaves like the product.

**`delivered: 60` is the server's own count** of WebSocket frames written, which
means sixty genuine sockets were open and registered server-side — not one
connection multiplexed.

## Two defects the live run found that 361 unit tests did not

**1. The phone never reported arrival.** The first run returned `tracked: 6` with
`counts.received: 0`. The real app posts `action: 'received'` the instant an
event arrives, before the proximity gate runs (`groupAlertGate.ts`); our
`VirtualPhone` posted only the gate's verdict. A dispatcher would have shown
every worker tracked and none reached. Every unit test passed because they all
assert on what the phone *decides*; none asserted on what it reports on arrival.
Fixed, with ordering tests.

**2. A measurement race in the verification itself, not in the code.** After the
fix, `counts.received` read 50 on one run and 18 on the next, with zero report
errors recorded. The reports are fire-and-forget by sixty phones at the instant
of broadcast, and the aggregate read was racing them. Confirmed by purging one
run's tenant afterwards and finding `response_events: 180` — every report had
landed. The verification now polls until the count settles. Worth recording
because the obvious reading of a short count is "the simulator is dropping
reports", and that reading was wrong.

## Notes and limitations

- **The browser leg is not covered here.** This ran under Node via vitest, which
  does not enforce CORS. The server's preflight was verified separately by hand
  (`OPTIONS /api/v1/auth/login` with `Origin: http://localhost:5173` → 200,
  `access-control-allow-origin: *`, and `access-control-allow-headers:
  authorization,content-type` echoed back when requested). A real cross-origin
  `fetch` from a browser, with the dev proxy bypassed, is still outstanding.
- **Every phone reported a fixed context** — scene origin, floor `"1"`, still,
  quiet — because Phase 1 does not move anyone. The event was unfloored and
  centred there, so all sixty were legitimately in range. Floor and radius
  gating are covered by unit tests against the vendored gate; a live run with
  workers on different floors belongs to the phase that gives them positions.
- **The verification harness is deliberately not in the repo.** It provisioned
  real accounts against a production server, and `npm run test:run` would have
  swept it up from `src/`. It was deleted after use. If this becomes a permanent
  integration suite it must live outside the default test glob and be opt-in by
  an explicit flag, never by remembering to pass `--exclude`.
- **Two tenants from earlier work cannot be purged**: the Task 1 registration
  probe and the first 6-worker run, both created before `is_demo` existed. The
  flag is settable only at registration, so they are permanent. Every tenant
  created since is purgeable and was purged.
