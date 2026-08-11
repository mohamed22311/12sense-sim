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

**Register**, then type the company's own details:

- **Company id** — lower-case letters and digits, e.g. `acme`. This is the key
  every account is derived from, so the screen shows you the result before it
  creates anything: `sim-acme-admin`, `sim-acme-w01` … `w60`.
- **Company name** — what the dispatcher shows. The site is appended
  automatically, because logging back in reads it from there.
- **Password** — shared by the admin and every worker.

Then pick **Factory** or **Construction site**, leave the count at 60, and press
**Start demo**. Roughly 25 s.

Use it once; from then on, log in. Registering again is not free: every company
is sixty more accounts on a shared server, and it starts the analytics over from
zero.

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

Open **How to pair a real phone** in the Session card. It is a live checklist —
it reads the current session and tells you which of these is still wrong, with
a button to fix what it can. The short version:

1. **Enrol with the join code.** Do *not* log in as `w01`–`w60`: the simulator
   already runs a phone for each of those, and two clients on one identity makes
   every result ambiguous.
2. **Put the site where the phone is** — **Set position on a map** in the Site
   anchor card. Every machine's coordinate is derived from that one point, so
   until it sits near the handset the phone is correctly hundreds of kilometres
   out of range.
3. **Widen the radius to about 30 m.** Phone GPS is 5–10 m out in the open and
   worse indoors; 12 m is right for the simulated fleet, which knows exactly
   where it is.
4. **Set the phone's floor** — Settings → My floor — and raise from a machine on
   that floor.

**Delivery is not a location problem.** The server broadcasts every alert to
every phone in the company; the app records the delivery before it even asks for
a fix. Position and floor only decide whether the phone *alarms*.

To make the phone feel the simulation move: take control of a worker, then press
**Pin anchor to driven worker**. Walking him moves the whole site relative to
your phone, so its distance to every machine changes.

## What to show, in order

1. **The site is alive** — six floors, sixty people working, each on their own
   floor. Click a floor to bring it forward.
2. **Walk into it.** Scroll to fly inside a floor; right-drag or shift-drag to
   pan. **Esc** puts the whole building back.
3. **A worker is a whole phone** — click anyone, then **Go to them** to stand in
   front of them. Their vitals and watch are what *that phone* decided, not what
   the server sent.
4. **Raise a real alert** — click a machine, press **Raise alert**. It offers
   only faults that machine could actually have. As you move the radius slider a
   red zone is drawn on that floor and the panel counts who would be reached:
   *"8 would be alerted · 2 on this floor, outside the circle · 50 on other
   floors."*
5. **The line that lands** — the **Alert reach** panel appears as soon as you
   raise one. *Some workers are metres away and correctly hear nothing, because
   they are a storey up.* Each phone decided that itself. Open the dispatcher:
   same numbers.
6. **Look at the watch.** Click an alarming worker, then **Look at their watch**
   — the camera flies to their wrist and you see the app's own alert screen, on
   the watch, from above. Press **Acknowledge** on it.
7. **Watch what acknowledging does.** The alarm clears everywhere at once, and
   the worker who answered walks to the machine and works on it.
8. **Health** — pick a calm worker, drag heart rate to ~150, **Send to the
   watch**. Their watch wakes with *"Danger — stop and rest now"*; **Look at
   their watch** and answer *"Got it — I'm resting"*, which reaches the
   dashboard as a real ack latency.
9. **Offboard** — *"Offboard this worker"* revokes them everywhere at once and
   their phone leaves the fleet. History stays.

## Moving the camera

Drag to orbit · right-drag or shift-drag to pan · scroll to fly inside a floor ·
**Esc** for the whole building. To reach one thing directly: **Go to it** in a
machine's dialog, **Go to them** in a worker's panel, or double-click a worker.

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
