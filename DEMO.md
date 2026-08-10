# Demo — the short version

The full runbook with limitations is in [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md).
This page is the part you need in your hand while presenting.

## Start it

```bash
cd scene-3d
npm install
npm run dev
```

Open the address it prints. Pick **Factory** or **Construction site**, leave the
count at 60, press **Start demo**.

Wait ~25 s while it registers the company and sixty accounts, then ~10 s more
for the sockets. The console shows the company name and join code once it is
running.

## Accounts

Created fresh every session. The console shows the current ones; the pattern is
always the same.

| Who | Username | Password |
|---|---|---|
| Dispatcher / admin | `sim-<slug>-admin` | `TwelveDemo2026` |
| Workers 1–60 | `sim-<slug>-w01` … `w60` | `TwelveDemo2026` |

**The session prepared for you:**

| | |
|---|---|
| Company | `Demo Factory nbszss` |
| Admin | `sim-nbszss-admin` / `TwelveDemo2026` |
| Join code | `DEMOFA-Z9AJW` |

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
4. **The line that lands** — *60 received it, 10 alarmed, 50 did not — and some
   of those 50 were 2.2 m away.* They were on other floors, and each phone
   decided that itself. Open the dispatcher: same numbers.
5. **Acknowledge** — the event resolves and the latency is recorded.
6. **Health** — pick a worker who is calm, drag heart rate to ~150, **Send to
   the watch**. Their watch wakes with *"Danger — stop and rest now"* and they
   answer *"Got it — I'm resting"*.

## Afterwards

Press **End and clear the data**. Without it, the next demo's analytics include
this one's events and acknowledgement rates.

## Two things not to promise

- **The first acknowledgement resolves the alert for everyone.** You cannot
  show ten people acking one alert — raise a second.
- **Push to a locked phone is unverified** on this deployment. Keep the app in
  the foreground unless you have tested it yourself.
