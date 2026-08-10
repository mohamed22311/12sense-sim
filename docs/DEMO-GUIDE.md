# Running the Twelve Senses demo

Everything below was verified against the live deployment on 2026-08-10, not
written from the code. Where something is unverified, it says so.

---

## 1. What this actually is

A 3D simulation of a six-storey site with sixty workers. Every worker has a
**real account on the real server**, a **real WebSocket**, and runs the mobile
app's **own decision code** — the proximity gate, the modality picker and the
health risk engine are the app's modules, copied in unmodified and checked
against the mobile repo on every build.

The one honest piece of fiction is the button that raises an alert. A sensor
would normally send it. Everything downstream of that button is real: a real
event id from the real ingestion pipeline, fanned out over real sockets,
counted by the real analytics.

**Why that matters for your demo:** you are not showing a mock-up. You can open
the dispatcher next to the simulation and the numbers agree, because they are
the same numbers.

---

## 2. Credentials

The session created for you:

| | |
|---|---|
| **Company** | `Demo Factory nbszss` |
| **Dispatcher / admin login** | `sim-nbszss-admin` |
| **Password** | `TwelveDemo2026` |
| **Worker logins** | `sim-nbszss-w01` … `sim-nbszss-w60` |
| **Worker password** | `TwelveDemo2026` (all of them) |
| **Join code (for a real phone)** | `DEMOFA-Z9AJW` |
| **Server** | `https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws` |

The password is the same for every account by design — it is a throwaway demo
tenant that gets purged at the end, and a demo where the presenter has to look
up sixty passwords is a demo that stalls.

**If you start a fresh session**, all of these change. The slug (`nbszss`) is
generated per session, so the pattern holds but the names do not:
`sim-<slug>-admin`, `sim-<slug>-wNN`. The console shows the company name and
join code while a session is running.

---

## 3. The real phone — read this before you try it

**Do not log the phone into one of the `w01`–`w60` accounts.** The simulator is
already running a virtual phone for every one of them: two clients would hold
sockets for one identity, both would report position, and the response row for
that worker would record whichever posted first. It half-works, which is worse
than not working, because it half-works *in front of a client*.

**Use the join code instead.** Enrol the handset with `DEMOFA-Z9AJW` and it
becomes worker #61 — a real account in the same company that the simulator does
not drive. It is then the only client for that identity, and everything it does
is unambiguous.

The code has no use limit and no expiry, so it works as many times as you need.

### What the phone will and will not do

**It will:** receive alerts you raise from the simulation, run its own gate
against its own GPS and floor, alarm on the channels its own modality logic
picks, and its ack will show up in the dispatcher against the same event as the
simulated workers' responses.

**It will follow the avatar — once you turn that on.** Take control of a
worker, then press **Pin anchor to driven worker** in the console.

Here is why that works, because it is worth being able to explain. A real phone
runs the gate on its own device against its own GPS, so nothing the simulator
does can move the handset. But the gate compares the phone's position against
the *alert's* coordinate, and the alert's coordinate comes from the site frame.
Pinning the frame's origin to the driven worker means he stands exactly where
the phone is — so walking him toward a machine walks that machine toward the
phone. The distance the handset computes changes because the site moved under
it.

Measured: walking the driven worker 7.58 m moved a machine's real-world
coordinate by 7.58 m. A stationary handset feels exactly that.

**Set the coordinate first.** Press **Use my location** so the site is anchored
where you and the phone actually are, then take control and pin. You can also
place the origin by hand with **Move the anchor** and a click on any floor —
useful when the phone is not beside you.

**The floor gate still applies.** The phone reports its own floor, and an alert
raised on floor 3 is gated to floor 3. If the handset reports a different floor
— or none — it will not alarm no matter how close it is. Raise the alert from
a machine on the floor the phone thinks it is on.

**Push notification to a locked phone is unverified.** The server supports FCM,
but I have not confirmed it is configured on this deployment, and the simulated
phones never register a device token so they cannot tell you either way. Keep
the app in the foreground for the demo, or test the locked-screen case yourself
before promising it.

---

## 4. Running it

1. `cd scene-3d && npm run dev`, then open the address it prints.
2. Choose **Factory** or **Construction site**, leave the worker count at 60,
   press **Start demo**. It takes about 25 seconds to register the company and
   sixty accounts.
3. Wait about 10 more seconds for every socket to connect before raising
   anything. The **On site** card showing 60 does not mean 60 are connected —
   it counts simulated workers, not sockets. The real proof comes in step 6.

---

## 5. What to show, in order

This sequence builds an argument rather than listing features.

**a. The site is alive.** Six floors, sixty people working — operating
machines, at terminals, carrying stock, inspecting, sweeping, on breaks, moving
between floors on the stairs and the lift. Click a floor in the right-hand rail
to bring it forward. Drag to orbit; scroll to zoom.

**b. One worker is a whole phone.** Click any worker. The panel shows what they
are doing, their live heart rate and SpO₂, and their watch. Point out that this
is not a readout the server sent — it is what *that phone* decided, on its own.

**c. Raise a real alert.** Click a machine and press **Raise alert**. The dialog
offers only alerts that machine could actually raise: a press offers "light
curtain broken during stroke", a chiller offers "refrigerant pressure high".
The result screen reports what the server did.

**d. The line that lands.** On the alert I raised as a test:

> **60 phones received it. 10 alarmed. 50 did not — and some of those 50 were
> 2.2 metres away.**

They were on other floors. The server did not decide that; each phone did, from
its own floor and position. This is the whole product in one sentence, and it
is the moment to open the dispatcher and show the same numbers from the other
side.

**e. Acknowledge.** Click a worker whose watch is alarming and press
**Acknowledge**. The dispatcher shows the event resolve and records the latency.

**f. Health, not proximity.** Click a worker who is *not* alarming. Drag heart
rate up to ~150 and press **Send to the watch**. This rewrites the last twenty
minutes of their history — a run, not a spike, because every rule the engine
applies is a sustained one.

A few seconds later the worker's watch wakes with **"Danger — stop and rest
now"** and the engine's own reason, on the channels the app's delivery rules
picked. Those are the handset's real strings: danger is alarm-grade with a
full-screen wake, caution is an audible heads-up, and every variant vibrates
because haptic is the safety floor. The worker answers with **"Got it — I'm
resting"**.

Nothing here faked an alert; it made one true, and then showed the worker
exactly what a real phone would show them.

**g. Clear up.** **End and clear the data** purges the tenant and reports what
was removed.

---

## 6. Proving the connection, if someone asks

The numbers on the alert result screen are the proof: **Delivered over socket**
is how many phones actually held a live connection. On my test run it read 60
of 60. If it reads lower, sockets are still connecting — wait and raise
another.

From the dispatcher side, the same event showed `tracked: 60`,
`received: 60`, and after one acknowledgement, `status: resolved` with
`ack_latency_s: 185`.

---

## 7. Limitations — the honest list

These are things I would not want you to discover in front of a client.

### Constraints of the product, not the simulator

- **The first acknowledgement resolves the alert for everyone.** That is the
  server's state machine, not a simulator shortcut. You cannot show ten people
  acking one alert — the moment the first ack lands, the event resolves and
  every other phone clears it. Raise a second alert if you want to show more
  responses.
- **A health alert cannot be snoozed or rejected.** The app calls them
  analytics-only: an episode ends `acknowledged` or `auto_recovered`, never
  both, so the only action on the watch is "Got it — I'm resting". That is the
  product's design, not a gap.
- **The health lifecycle endpoint is still a proposal.** The app posts
  acknowledgements to `POST /individual-alerts/{id}/events` and treats
  404/405/501 as terminal, dropping the record. The simulator does the same, so
  the worker's answer always shows locally whatever the server has shipped —
  but do not promise the *dashboard* will show a health ack latency until that
  endpoint lands.

### Constraints of the simulator

- **The floor gate is not simulated for a real phone.** Everything else about
  a handset's position can be driven from here; its *floor* cannot, because the
  app reads that from the phone itself. Raise alerts from machines on the floor
  the phone reports.
- **One site per session.** Choosing Factory or Construction site registers a
  company for that site. To demo the other one, end the session and start
  again — which also means a new company and new credentials.
- **The camera cannot go behind the building.** Deliberate. It is a cutaway:
  from behind you would see five dimmed walls and no interior. The orbit stops
  at about 72° either side of the open face.
- **Visual quality drops itself on slower machines.** The renderer measures the
  first second and picks a tier. On a slow laptop the glow and the finer worker
  detail switch off automatically. It will still run; it will look plainer.
  Nothing you can do about it mid-demo, so check your demo machine beforehand.
- **`?preview` has no accounts.** Adding `?preview` to the URL runs the whole
  simulation with no network at all — useful for rehearsing the visuals without
  spending a tenant, but nothing can be raised and no dispatcher data appears.

### Fixed since the first draft of this guide

Recorded because they appear in older notes:

- The avatar used to have no effect on a real phone. It does now — see §3.
- The alarm list used to clear by hand. It now polls the server every four
  seconds and drops anything resolved, including alerts acknowledged on a
  handset rather than in this window. Verified end to end: raise → 1 listed,
  acknowledge → 0 listed.
- Health alerts used to reach only the dashboard. That was wrong about the
  *product*, not just the simulator: the app has always woken the worker for
  them. The watch now shows the same alert with the app's own titles, its own
  delivery channels and its own "Got it — I'm resting" action.

### Things that are simply not built yet

- **QR / profile-code enrolment of a specific named person.** The join code
  works and creates a generic worker; pairing a *named* account to a handset by
  QR is not built.
- **No dispatcher view inside the simulator.** You need the real dashboard open
  in another window; the console shows the simulation's own view, not the
  server's.
- **Nothing drives the demo automatically.** There is no scripted scenario or
  timeline — every alert is raised by hand, which means the pacing is yours and
  a silent simulation stays silent.

---

## 8. Before demoing to someone else

Press **End and clear the data**. It deletes the company and everything it
recorded, and reports the row counts it removed.

This matters more than it sounds: without it, the second demo's analytics
include the first demo's events, acknowledgement rates and latencies. That is
the one way this tool can actively mislead someone, and it takes one click to
avoid.
