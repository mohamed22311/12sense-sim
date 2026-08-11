# Demo — the short version

The full runbook with limitations is in [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md).
This page is the part you need in your hand while presenting.

## Start it

```bash
cd scene-3d
npm install
npm run dev
```

Open the address it prints. There are two ways in.

### Log in — use this one

The default tab, and the one to use for a real demo. Click the company under
**Recent**, or type its admin username, and press **Log in**. Every worker
signs back in: the same sixty accounts, with everything they have recorded in
every run before this one. Nothing new is created.

Takes ~20 s for sixty accounts, then ~10 s for the sockets.

### Register — only for a brand-new company

**Register** → pick **Factory** or **Construction site** → leave the count at
60 → **Start demo**. Roughly 25 s. Use it once; from then on, log in.

Registering again is not free: every company is sixty more accounts on a shared
server, and it starts the analytics over from zero.

## Accounts

Every account is derived from one thing — the company's slug — so the admin
username is all you need to get the whole site back.

| Who | Username | Password |
|---|---|---|
| Dispatcher / admin | `sim-<slug>-admin` | `TwelveDemo2026` |
| Workers 1–60 | `sim-<slug>-w01` … `w60` | `TwelveDemo2026` |

That is 61 accounts per company: sixty workers and one admin.

**The company to demo with:**

| | |
|---|---|
| Company | `Demo Factory ovdh4q` |
| Admin | `sim-ovdh4q-admin` / `TwelveDemo2026` |
| Join code | `DEMOFA-YS2U2` |

Type the admin username on the **Log in** tab and all sixty come back.

Server: `https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws`

## Your real phone

**Use the join code — do not log in as `w01`–`w60`.** Those sixty accounts are
already being driven by the simulator; a second client on one of them makes the
results ambiguous. Enrolling with the code makes the handset worker #61, which
nothing else is driving.

To make the phone feel the simulation move: press **Use my location**, take
control of a worker, then press **Pin anchor to driven worker**. Walking him
now moves the whole site relative to your phone, so its distance to every
machine changes.

Raise alerts from machines on the floor your phone reports — the floor gate is
the one thing the simulator cannot drive for a real handset.

## Six things to show

1. **The site is alive** — six floors, sixty people working. Click a floor to
   bring it forward.
2. **A worker is a whole phone** — click anyone. Their vitals and watch are
   what *that phone* decided, not what the server sent.
3. **Raise a real alert** — click a machine, press **Raise alert**. It offers
   only faults that machine could actually have.
4. **The line that lands** — the **Alert reach** panel appears as soon as you
   raise one: how many alarmed, how many were on another floor, and how close
   the nearest silent worker was. *Some of them are metres away and correctly
   hear nothing, because they are a storey up.* Each phone decided that
   itself. Open the dispatcher: same numbers.
5. **Acknowledge** — the event resolves and the latency is recorded.
6. **Health** — pick a worker who is calm, drag heart rate to ~150, **Send to
   the watch**. Their watch wakes with *"Danger — stop and rest now"* and they
   answer *"Got it — I'm resting"*, which reaches the dashboard as a real ack
   latency.
7. **Offboard** — *"Offboard this worker"* revokes them everywhere at once and
   their phone leaves the fleet. History stays.

## Afterwards

Press **End and clear the data**. Without it, the next demo's analytics include
this one's events and acknowledgement rates.

## If the dispatcher looks empty

`GET /events` has a `simulated` filter, and everything the simulator raises is
`source=sim`. A console set to `simulated=false` shows **nothing**. Check that
before you check anything else — it is the one setting that makes a working
system look broken.

## Two things not to promise

- **The first acknowledgement resolves the alert for everyone.** You cannot
  show ten people acking one alert — raise a second.
- **Push to a locked phone is unverified** on this deployment. Keep the app in
  the foreground unless you have tested it yourself.
