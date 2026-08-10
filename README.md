# Twelve Senses — Demo Simulator

The deployed build of the demo simulator. **Start here: [`DEMO.md`](DEMO.md)** for
accounts and the runbook, or [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md) for the
full version with limitations.

A 3D simulation of a six-storey site with sixty workers. Every worker has a real
account on the real server, a real WebSocket, and runs the mobile app's own
decision code — the proximity gate, the modality picker and the health risk
engine are the app's modules, copied in unmodified.

## This repo is a mirror

The source of truth is
[`TwelveSense-TT-SimData`](https://github.com/OmdenaAI/TwelveSense-TT-SimData),
where the app lives under `scene-3d/`. Here it sits at the repository root,
because Vercel builds from the root.

**Make changes upstream and re-sync.** Editing here directly will be overwritten
by the next sync, and the vendored-module drift check cannot run here (see
below), so a change made here loses the guard that keeps the simulator honest
about the app's behaviour.

## Local

```bash
npm install
npm run dev
```

`?preview` runs the whole simulation with no network at all — no accounts, no
tenant — which is how the scene is worked on without provisioning sixty real
logins. `?preview=construction` does the same for the other site.

## Deployment

Vercel builds `npm run build` to `dist`. Two rewrites, and the order matters:

1. `/api/:path*` proxies to the deployed backend. This is what replaces the
   Vite dev proxy in production, and it means the browser sees the API as
   same-origin — so the app works regardless of the server's CORS
   configuration, exactly as it does in development.
2. `/(.*)` serves `index.html`, so a deep link does not 404.

Point `VITE_API_BASE_URL` at the backend directly if you would rather skip the
proxy; the app reads it and falls back to `/api/v1`.

## `npm run check:vendor` skips here

The simulator copies pure decision modules from the mobile app byte-for-byte,
and that script proves the copies have not drifted from the pinned commit. It
needs a mobile checkout beside the repo, which a deployment mirror does not
have, so it skips with a message rather than failing.

Run it in `TwelveSense-TT-SimData`, where the mobile repo sits alongside. A
check that cannot see its source proves nothing either way, and a script that
is always red trains people to ignore it where it genuinely works.
