export const CAMERA_OVERVIEW = {
  position: [0, 7.0, 15] as [number, number, number],
  target:   [0, 1.2, -5] as [number, number, number],
};

export const CAMERA_FOCUS = {
  // Workers — tight watch closeup (fallback; dynamic tracking overrides immediately)
  'tech-104':        { position: [ 1.8,  1.1, -5.9] as [number,number,number], target: [ 2.1,  0.7, -6.2] as [number,number,number] },
  'tech-201':        { position: [-3.2,  1.1, -5.4] as [number,number,number], target: [-2.8,  0.7, -5.8] as [number,number,number] },
  'tech-312':        { position: [ 0.1,  1.1, -9.2] as [number,number,number], target: [ 0.5,  0.7, -9.6] as [number,number,number] },
  'tech-445':        { position: [-4.1,  1.1, -1.8] as [number,number,number], target: [-3.7,  0.7, -2.1] as [number,number,number] },
  'tech-556':        { position: [ 3.4,  1.1, -2.8] as [number,number,number], target: [ 3.8,  0.7, -3.1] as [number,number,number] },
  // Central reactor — wide 3/4 view
  'CENTRAL-REACTOR': { position: [ 0,    4.0, -1.0] as [number,number,number], target: [ 0,    1.5, -7.5] as [number,number,number] },
  // Admin
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
}

// ─── Simulation workers — 3 around central reactor, 2 patrolling ────────────
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
    position: [-3.5, 0, -2.0], facing: Math.PI * 0.1,
    motion: 'walking',
    walkPath: [
      [-3.5, 0, -2.0], [-4.8, 0, -4.5], [-4.8, 0, -7.0],
      [-3.5, 0, -9.5], [-1.0, 0, -9.0], [ 0.5, 0, -7.5],
      [ 1.5, 0, -5.0], [ 0.0, 0, -3.0], [-2.0, 0, -1.5],
    ],
  },
  {
    id: 'tech-556', name: 'Carlos Reyes', role: 'Maintenance Tech', skinIndex: 4,
    position: [4.0, 0, -3.0], facing: -Math.PI * 0.9,
    motion: 'walking',
    walkPath: [
      [ 4.0, 0, -3.0], [ 4.8, 0, -5.0], [ 4.8, 0, -7.5],
      [ 3.5, 0, -9.5], [ 1.5, 0, -9.0], [ 0.5, 0, -7.0],
      [ 2.0, 0, -5.0], [ 3.0, 0, -2.0], [ 4.5, 0, -1.5],
    ],
  },
];

// ─── Central simulation machine (the one machine that fires alerts) ──────────
export const MACHINE_DEFS: MachineDef[] = [
  { id: 'CENTRAL-REACTOR', label: 'REACTOR-01', position: [0, 0, -7.5], type: 'reactor' },
];

// ─── Wall machines — decorative, no alert interaction ───────────────────────
// rotation PI/2  = machine front faces +X (toward center, for left-wall machines)
// rotation -PI/2 = machine front faces -X (toward center, for right-wall machines)
export const WALL_MACHINE_DEFS: WallMachineDef[] = [
  { id: 'WALL-CH-L1', label: 'CHILLER-L1', position: [-6.8, 0, -4.5],  type: 'chiller', rotation:  Math.PI / 2 },
  { id: 'WALL-PA-L2', label: 'PANEL-L2',   position: [-6.8, 0, -10.0], type: 'panel',   rotation:  Math.PI / 2 },
  { id: 'WALL-FU-R1', label: 'FURNACE-R1', position: [ 6.8, 0, -4.5],  type: 'chiller', rotation: -Math.PI / 2 },
  { id: 'WALL-CO-R2', label: 'COMP-R2',    position: [ 6.8, 0, -10.0], type: 'panel',   rotation: -Math.PI / 2 },
];

// ─── Decorative workers ──────────────────────────────────────────────────────
// facing -PI/2 = face -X (toward left wall)
// facing  PI/2 = face +X (toward right wall)
// facing     0 = face +Z (toward front/camera)
// facing    PI = face -Z (toward back wall)
export const DECO_WORKER_DEFS: DecoWorkerDef[] = [
  // Left wall chiller (z=-4.5): workers face the machine (-X direction)
  { id: 'dw-L1a', position: [-5.3, 0, -4.0],  facing: -Math.PI / 2, skinIndex: 1 },
  { id: 'dw-L1b', position: [-5.3, 0, -5.1],  facing: -Math.PI / 2, skinIndex: 3 },
  // Left wall panel (z=-10.0)
  { id: 'dw-L2a', position: [-5.3, 0, -9.5],  facing: -Math.PI / 2, skinIndex: 0 },
  { id: 'dw-L2b', position: [-5.3, 0, -10.5], facing: -Math.PI / 2, skinIndex: 2 },
  // Right wall chiller (z=-4.5): workers face the machine (+X direction)
  { id: 'dw-R1a', position: [ 5.3, 0, -4.0],  facing:  Math.PI / 2, skinIndex: 4 },
  { id: 'dw-R1b', position: [ 5.3, 0, -5.1],  facing:  Math.PI / 2, skinIndex: 1 },
  // Right wall panel (z=-10.0)
  { id: 'dw-R2a', position: [ 5.3, 0, -9.5],  facing:  Math.PI / 2, skinIndex: 2 },
  { id: 'dw-R2b', position: [ 5.3, 0, -10.5], facing:  Math.PI / 2, skinIndex: 0 },
  // Stair workers — at different heights on the staircase (left side, x≈-6.8)
  { id: 'dw-S1',  position: [-6.8, 1.0, -2.3], facing:  Math.PI,    skinIndex: 3 },
  { id: 'dw-S2',  position: [-6.8, 2.5, -3.4], facing:  0.0,        skinIndex: 1 },
  // Mezzanine walkway workers (y=3.5, against left wall)
  { id: 'dw-M1',  position: [-6.8, 3.5, -5.5], facing: -Math.PI / 2, skinIndex: 4 },
  { id: 'dw-M2',  position: [-6.8, 3.5, -8.5], facing:  Math.PI / 2, skinIndex: 2 },
];
