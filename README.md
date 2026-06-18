# TwelveSense — 3D Alert Simulation

Interactive 3D factory simulation that demonstrates the Twelve Senses multimodal alert routing system. Workers wear smartwatches; when a machine raises an alert the system routes notifications (haptic / audio / visual) to the nearest workers based on their real-time sensor context.

---

## What it does

- **5 animated factory workers** with procedurally generated characters, each carrying a smartwatch
- **4 industrial machines** (Chiller, Electrical Panel, Furnace, Compressor)
- **Alert pipeline** — machine failure → context scan → AI routing → orb delivery → per-worker modality effects
- **Smartwatch closeup** — click any worker to zoom to their wrist; the watch face shows live sensor data, active alerts, and tap-to-acknowledge
- **Haptic simulation** — watch vibrates in a repeating buzz-rest cycle while an alert is active
- **Audio** — exactly one worker (the one with an audio routing channel) receives a beep + voice announcement
- **Draggable sensor panel** — floats alongside the 3D view so the watch remains unobstructed
- **Admin dashboard** — full event log with routing decisions, worker avatars, modality badges, and distances

---

## Tech stack

| Layer | Library |
|---|---|
| 3D rendering | Three.js 0.170 via @react-three/fiber 8 |
| 3D helpers | @react-three/drei 9 |
| State | Zustand 5 |
| UI | React 18 + TypeScript |
| Build | Vite 6 |

No GLTF/FBX assets — all geometry is procedural (RoundedBox, cylinders, spheres). Watch faces use `<canvas>` textures updated reactively.

---

## Running locally

### Prerequisites

- Node.js 18 or later
- npm 9 or later

### Steps

```bash
# 1. Enter the simulation project
cd scene-3d

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

The app opens at **http://localhost:5173** (Vite may use a different port if 5173 is busy — check the terminal output).

### Build for production

```bash
cd scene-3d
npm run build        # outputs to scene-3d/dist/
npm run preview      # local preview of the production build
```

---

## How to use the simulation

| Action | Result |
|---|---|
| Click a worker | Camera zooms to their smartwatch; sensor panel opens on the right |
| Drag the panel header | Move the panel anywhere on screen |
| Click a machine | Camera zooms to it; alert console opens |
| Click the admin computer | Full dashboard with event log |
| Click empty space | Return to overview camera |
| **Machine panel → Fire Alert** | Triggers the full alert pipeline for that machine |
| Watch screen tap (alert active) | Acknowledges the alert |
| Panel → Alerts tab → ACK | Alternative acknowledge button |
| ↺ Reset button | Resets the scene to idle state |
| 🔊 Mute button | Silences beep and voice announcements |

### Alert routing rules

| Worker state | Modality |
|---|---|
| Moving + high noise (>70 dB) | Haptic + Audio |
| Moving + low noise | Haptic + Audio |
| Stationary + high noise | Haptic + Visual |
| Stationary + low noise | Visual + Audio |

Only the **two nearest workers** to the faulting machine receive an alert. Of those, only the **first worker with an audio channel** gets the beep + voice announcement.

---

## Project structure

```
scene-3d/
├── src/
│   ├── App.tsx              # Root UI: panels, sound, scenario hooks
│   ├── scene/
│   │   ├── Scene.tsx        # Canvas, camera rig, lighting
│   │   ├── Worker.tsx       # Worker character, watch face, arm raise
│   │   ├── AlertOrb.tsx     # Orb travel animation, worker effect delivery
│   │   ├── Machine.tsx      # Industrial machine geometry
│   │   ├── AdminStation.tsx # Admin desk + monitor
│   │   ├── sceneDefs.ts     # Worker/machine positions and camera targets
│   │   └── workerFocusRef.ts# Shared watch world-position for camera tracking
│   ├── state/
│   │   └── store.ts         # Zustand store: workers, alerts, routing logic
│   ├── hooks/
│   │   └── useScenario.ts   # Phase-transition timer (machine_fail → alerting)
│   └── styles/
│       ├── global.css        # Panel / overlay styles
│       └── palette.ts        # Shared color constants
└── package.json
```
