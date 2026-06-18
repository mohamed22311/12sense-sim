export const CAMERA_OVERVIEW = {
  position: [0, 7.0, 15] as [number, number, number],
  target:   [0, 1.2, -5] as [number, number, number],
};

export const CAMERA_FOCUS = {
  'tech-104':        { position: [ 1.8,  1.1, -5.9] as [number,number,number], target: [ 2.1,  0.7, -6.2] as [number,number,number] },
  'tech-201':        { position: [-3.2,  1.1, -5.4] as [number,number,number], target: [-2.8,  0.7, -5.8] as [number,number,number] },
  'tech-312':        { position: [ 0.1,  1.1, -9.2] as [number,number,number], target: [ 0.5,  0.7, -9.6] as [number,number,number] },
  'tech-445':        { position: [-4.1,  1.1, -1.8] as [number,number,number], target: [-3.7,  0.7, -2.1] as [number,number,number] },
  'tech-556':        { position: [ 3.4,  1.1, -2.8] as [number,number,number], target: [ 3.8,  0.7, -3.1] as [number,number,number] },
  'CENTRAL-REACTOR': { position: [ 0,    4.0, -1.0] as [number,number,number], target: [ 0,    1.5, -7.5] as [number,number,number] },
  'admin':           { position: [ 0,    1.7,  2.6] as [number,number,number], target: [ 0,    1.55, 4.0] as [number,number,number] },
};

export interface WorkerDef {
  id: string;
  name: string;
  role: string;
  skinIndex: number;
  position: [number, number, number];
  facing: number;
  motion: 'walking' | 'idle' | 'inspect';
  walkPath?: [number, number, number][];
}

export interface MachineDef {
  id: string;
  label: string;
  position: [number, number, number];
  type: 'chiller' | 'panel' | 'reactor';
  rotation?: number;
}

export interface WallMachineDef {
  id: string;
  label: string;
  position: [number, number, number];
  type: 'chiller' | 'panel';
  rotation: number;
}

export interface DecoWorkerDef {
  id: string;
  position: [number, number, number];
  facing: number;
  skinIndex: number;
  role?: 'panel' | 'carry' | 'wrench' | 'inspect' | 'idle';
}

// ─── Simulation workers — 3 static around reactor, 2 patrolling corridors ────
// Walk paths route around the reactor (plinth at [0,0,-7.5], radius ~1.8)
// and avoid wall machines (x ±6.8) and back machines (z -13.6).
export const WORKER_DEFS: WorkerDef[] = [
  {
    id: 'tech-104', name: 'Ahmed Al-Rashidi', role: 'Field Technician', skinIndex: 0,
    position: [2.5, 0, -6.5], facing: -Math.PI * 0.85,
    motion: 'idle',
  },
  {
    id: 'tech-201', name: 'Sarah Mitchell', role: 'Equipment Specialist', skinIndex: 2,
    position: [-2.5, 0, -6.0], facing: Math.PI * 0.85,
    motion: 'inspect',
  },
  {
    id: 'tech-312', name: 'Omar Hassan', role: 'Senior Technician', skinIndex: 1,
    position: [0.8, 0, -9.8], facing: 0.05,
    motion: 'idle',
  },
  {
    id: 'tech-445', name: 'Fatima Al-Zahra', role: 'Safety Officer', skinIndex: 3,
    position: [-3.5, 0, -1.5], facing: Math.PI * 0.1,
    motion: 'walking',
    walkPath: [
      [-3.5, 0, -1.5], [-4.5, 0, -4.0], [-4.5, 0, -7.0],
      [-3.5, 0, -9.5], [-1.5, 0, -12.0], [ 1.5, 0, -12.0],
      [ 3.5, 0, -9.5], [ 4.5, 0, -7.0],  [ 4.5, 0, -4.0],
      [ 0.0, 0, -2.0],
    ],
  },
  {
    id: 'tech-556', name: 'Carlos Reyes', role: 'Maintenance Tech', skinIndex: 4,
    position: [4.5, 0, -2.5], facing: -Math.PI * 0.9,
    motion: 'walking',
    walkPath: [
      [ 4.5, 0, -2.5], [ 5.0, 0, -5.0], [ 5.0, 0, -8.0],
      [ 3.5, 0, -11.0], [ 1.5, 0, -12.5], [-1.5, 0, -12.0],
      [-4.0, 0, -9.5], [-4.5, 0, -6.5],  [-3.5, 0, -3.5],
      [ 0.0, 0, -1.5],
    ],
  },
];

// ─── Central simulation machine ───────────────────────────────────────────────
export const MACHINE_DEFS: MachineDef[] = [
  { id: 'CENTRAL-REACTOR', label: 'REACTOR-01', position: [0, 0, -7.5], type: 'reactor' },
];

// ─── Wall + mezzanine machines — decorative, no alert interaction ─────────────
// rotation  PI/2 = front faces +X (left-side machines face center)
// rotation -PI/2 = front faces -X (right-side machines face center)
// rotation     0 = front faces +Z (back-wall machines face camera/factory)
export const WALL_MACHINE_DEFS: WallMachineDef[] = [
  // Left wall
  { id: 'WALL-CH-L1', label: 'CHILLER-L1', position: [-6.8, 0, -4.5],  type: 'chiller', rotation:  Math.PI / 2 },
  { id: 'WALL-PA-L2', label: 'PANEL-L2',   position: [-6.8, 0, -10.0], type: 'panel',   rotation:  Math.PI / 2 },
  // Right wall
  { id: 'WALL-FU-R1', label: 'FURNACE-R1', position: [ 6.8, 0, -4.5],  type: 'chiller', rotation: -Math.PI / 2 },
  { id: 'WALL-CO-R2', label: 'COMP-R2',    position: [ 6.8, 0, -10.0], type: 'panel',   rotation: -Math.PI / 2 },
  // Back wall (faces +Z toward factory floor)
  { id: 'WALL-BK-L1', label: 'BOILER-BK1', position: [-2.5, 0, -13.6], type: 'chiller', rotation: 0 },
  { id: 'WALL-BK-R1', label: 'PUMP-BK1',   position: [ 2.5, 0, -13.6], type: 'panel',   rotation: 0 },
  // Mezzanine level (y=3.62 = standing on mezzanine floor top surface)
  // Front faces +X (workers stand on inner mezzanine side at x≈-5.8)
  { id: 'MEZZ-PA-M1', label: 'CTRL-M1',    position: [-7.2, 3.62, -6.5],  type: 'panel',   rotation:  Math.PI / 2 },
  { id: 'MEZZ-CH-M2', label: 'PUMP-M2',    position: [-7.2, 3.62, -11.5], type: 'chiller', rotation:  Math.PI / 2 },
];

// ─── Decorative workers ───────────────────────────────────────────────────────
// Mezzanine floor top surface is at y = 3.5 + 0.06 = 3.56
// Stair tread tops (step i): y = (i+1)*0.5, front z = -0.5 - i*0.55
export const DECO_WORKER_DEFS: DecoWorkerDef[] = [
  // ── Left wall chiller (z=-4.5) — workers face machine (-X) ───────────
  { id: 'dw-L1a', position: [-5.3, 0, -4.0],  facing: -Math.PI / 2, skinIndex: 1, role: 'panel'   },
  { id: 'dw-L1b', position: [-5.3, 0, -5.1],  facing: -Math.PI / 2, skinIndex: 3, role: 'wrench'  },
  // ── Left wall panel (z=-10.0) ─────────────────────────────────────────
  { id: 'dw-L2a', position: [-5.3, 0, -9.5],  facing: -Math.PI / 2, skinIndex: 0, role: 'inspect' },
  { id: 'dw-L2b', position: [-5.3, 0, -10.5], facing: -Math.PI / 2, skinIndex: 2, role: 'panel'   },
  // ── Right wall chiller (z=-4.5) — workers face machine (+X) ──────────
  { id: 'dw-R1a', position: [ 5.3, 0, -4.0],  facing:  Math.PI / 2, skinIndex: 4, role: 'wrench'  },
  { id: 'dw-R1b', position: [ 5.3, 0, -5.1],  facing:  Math.PI / 2, skinIndex: 1, role: 'panel'   },
  // ── Right wall panel (z=-10.0) ────────────────────────────────────────
  { id: 'dw-R2a', position: [ 5.3, 0, -9.5],  facing:  Math.PI / 2, skinIndex: 2, role: 'inspect' },
  { id: 'dw-R2b', position: [ 5.3, 0, -10.5], facing:  Math.PI / 2, skinIndex: 0, role: 'panel'   },
  // ── Back wall machines — workers face machine (PI = face -Z) ─────────
  { id: 'dw-BK-L1', position: [-2.5, 0, -12.8], facing: Math.PI, skinIndex: 3, role: 'panel'   },
  { id: 'dw-BK-L2', position: [-3.4, 0, -12.5], facing: Math.PI, skinIndex: 0, role: 'wrench'  },
  { id: 'dw-BK-R1', position: [ 2.5, 0, -12.8], facing: Math.PI, skinIndex: 1, role: 'panel'   },
  { id: 'dw-BK-R2', position: [ 3.4, 0, -12.5], facing: Math.PI, skinIndex: 4, role: 'carry'   },
  // ── Stair workers — fixed on tread surfaces ───────────────────────────
  { id: 'dw-S1', position: [-7.1, 1.0, -1.1],  facing: Math.PI, skinIndex: 3, role: 'idle' },
  { id: 'dw-S2', position: [-7.1, 2.5, -2.75], facing: 0.0,     skinIndex: 1, role: 'idle' },
  // ── Mezzanine workers (y=3.56 = top of mezzanine floor) ───────────────
  { id: 'dw-M1', position: [-5.8, 3.56, -6.5],  facing: -Math.PI / 2, skinIndex: 4, role: 'panel'   },
  { id: 'dw-M2', position: [-5.8, 3.56, -11.5], facing: -Math.PI / 2, skinIndex: 2, role: 'wrench'  },
  { id: 'dw-M3', position: [-6.5, 3.56, -9.0],  facing:  0,           skinIndex: 0, role: 'carry'   },
];
