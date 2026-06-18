import { create } from 'zustand';
import { WORKER_DEFS } from '../scene/sceneDefs';

export type ScenarioPhase =
  | 'idle'
  | 'machine_fail'
  | 'context_scan'
  | 'routing'
  | 'delivery'
  | 'alerting'
  | 'acknowledged';

export type Modality = 'haptic' | 'audio' | 'visual';
export type MachineAlertType = 'fire' | 'electrical' | 'pressure';

export interface SensorData {
  heart_rate: number;
  stress_index: number;
  spo2: number;
  noise_level: number;
  motion_state: 'Walking' | 'Running' | 'Stationary' | 'Resting';
  battery: number;
  hrv?: number;
  skin_temp?: number;
  steps?: number;
  ecg?: number;
}

export interface RoutingDecision {
  channels: Modality[];
  primary: Modality;
  suppressed: Modality[];
}

export interface WorkerEffect {
  vibrating: boolean;
  flashing: boolean;
  audioWaves: boolean;
  ringColor: string;
  ringPulse: boolean;
  ackArm: boolean;
  dangerFlag: boolean;
}

export interface AlertDecision {
  workerId: string;
  workerName: string;
  workerRole: string;
  channels: Modality[];
  primary: Modality;
  reason: string;
  distM: number;
  acknowledged: boolean;
  flags: string[];
}

export interface WorkerState {
  id: string;
  name: string;
  role: string;
  skinIndex: number;
  sensors: SensorData;
  routing: RoutingDecision;
  effects: WorkerEffect;
  visibleFields: string[];
}

export interface Alert {
  id: string;
  assetId: string;
  severity: string;
  title: string;
  alertType: MachineAlertType;
  workOrder: string;
  firedAt: number;
  acknowledged: boolean;
  decisions: AlertDecision[];
}

function routeWorker(sensors: SensorData): RoutingDecision {
  const moving   = sensors.motion_state === 'Walking' || sensors.motion_state === 'Running';
  const highNoise = sensors.noise_level > 70;
  if (moving && highNoise)  return { channels: ['haptic', 'audio'],  primary: 'haptic', suppressed: ['visual'] };
  if (moving && !highNoise) return { channels: ['haptic', 'audio'],  primary: 'haptic', suppressed: ['visual'] };
  if (!moving && highNoise) return { channels: ['haptic', 'visual'], primary: 'haptic', suppressed: ['audio']  };
  return                           { channels: ['visual', 'audio'],  primary: 'visual', suppressed: ['haptic'] };
}

function buildReason(moving: boolean, highNoise: boolean): string {
  if (moving && highNoise)  return 'In motion + high noise — haptic primary, audio secondary';
  if (moving && !highNoise) return 'In motion + low noise — haptic primary, audio secondary';
  if (!moving && highNoise) return 'Stationary + high noise — haptic + visual (audio suppressed)';
  return 'Stationary + low noise — visual primary, audio secondary';
}

function buildFlags(sensors: SensorData): string[] {
  const flags: string[] = [];
  if (sensors.stress_index > 70) flags.push('High Stress');
  if (sensors.heart_rate > 100)  flags.push('Elevated HR');
  if (sensors.spo2 < 95)         flags.push('Low SpO₂');
  if (sensors.battery < 15)      flags.push('Low Battery');
  if (sensors.noise_level > 70)  flags.push(`${Math.round(sensors.noise_level)} dB`);
  return flags;
}

const defaultEffects = (): WorkerEffect => ({
  vibrating: false, flashing: false, audioWaves: false,
  ringColor: '#22c55e', ringPulse: false, ackArm: false, dangerFlag: false,
});

const DEFAULT_VISIBLE_FIELDS = ['heart_rate', 'spo2', 'stress_index', 'noise_level', 'battery'];

const SENSOR_FIELD_DEFAULTS: Partial<SensorData> = {
  hrv: 45, skin_temp: 36.5, steps: 3450, ecg: 0.1,
};

const INITIAL_WORKERS: WorkerState[] = [
  {
    id: 'tech-104', name: 'Ahmed Al-Rashidi', role: 'Field Technician', skinIndex: 0,
    sensors: { heart_rate: 92, stress_index: 55, spo2: 97.5, noise_level: 86, motion_state: 'Walking',    battery: 78 },
    routing: routeWorker({ heart_rate: 92, stress_index: 55, spo2: 97.5, noise_level: 86, motion_state: 'Walking', battery: 78 }),
    effects: defaultEffects(),
    visibleFields: [...DEFAULT_VISIBLE_FIELDS],
  },
  {
    id: 'tech-201', name: 'Sarah Mitchell', role: 'Equipment Specialist', skinIndex: 2,
    sensors: { heart_rate: 68, stress_index: 18, spo2: 99,   noise_level: 43, motion_state: 'Stationary', battery: 91 },
    routing: routeWorker({ heart_rate: 68, stress_index: 18, spo2: 99, noise_level: 43, motion_state: 'Stationary', battery: 91 }),
    effects: defaultEffects(),
    visibleFields: [...DEFAULT_VISIBLE_FIELDS],
  },
  {
    id: 'tech-312', name: 'Omar Hassan', role: 'Senior Technician', skinIndex: 1,
    sensors: { heart_rate: 118, stress_index: 84, spo2: 94.5, noise_level: 89, motion_state: 'Stationary', battery: 12 },
    routing: routeWorker({ heart_rate: 118, stress_index: 84, spo2: 94.5, noise_level: 89, motion_state: 'Stationary', battery: 12 }),
    effects: defaultEffects(),
    visibleFields: [...DEFAULT_VISIBLE_FIELDS],
  },
  {
    id: 'tech-445', name: 'Fatima Al-Zahra', role: 'Safety Officer', skinIndex: 3,
    sensors: { heart_rate: 74, stress_index: 28, spo2: 98.5, noise_level: 62, motion_state: 'Stationary', battery: 85 },
    routing: routeWorker({ heart_rate: 74, stress_index: 28, spo2: 98.5, noise_level: 62, motion_state: 'Stationary', battery: 85 }),
    effects: defaultEffects(),
    visibleFields: [...DEFAULT_VISIBLE_FIELDS],
  },
  {
    id: 'tech-556', name: 'Carlos Reyes', role: 'Maintenance Tech', skinIndex: 4,
    sensors: { heart_rate: 88, stress_index: 42, spo2: 97.0, noise_level: 75, motion_state: 'Walking',    battery: 63 },
    routing: routeWorker({ heart_rate: 88, stress_index: 42, spo2: 97.0, noise_level: 75, motion_state: 'Walking', battery: 63 }),
    effects: defaultEffects(),
    visibleFields: [...DEFAULT_VISIBLE_FIELDS],
  },
];

const ALERT_TITLES: Record<MachineAlertType, string> = {
  fire:       'Fire hazard detected',
  electrical: 'Electrical fault detected',
  pressure:   'Pressure anomaly detected',
};

const WORK_ORDERS: Record<string, string> = {
  'CENTRAL-REACTOR': 'WO-48230',
  'CHILLER-07':      'WO-48219',
  'PANEL-07':        'WO-48220',
  'FURNACE-03':      'WO-48221',
  'COMPRESSOR-01':   'WO-48222',
};

const MACHINE_POS: Record<string, [number, number, number]> = {
  'CENTRAL-REACTOR': [0, 0, -7.5],
  'CHILLER-07':      [-3.5, 0, -5.5],
  'PANEL-07':        [ 3.5, 0, -5.5],
  'FURNACE-03':      [-4.0, 0, -10.5],
  'COMPRESSOR-01':   [ 4.0, 0, -10.5],
};

// Seed event decisions — hardcoded based on initial worker sensor data + nearest-2 logic
const _now = Date.now();
const SEED_EVENTS: Alert[] = [
  {
    id: 'SEED-001', assetId: 'CHILLER-07', severity: 'critical', alertType: 'pressure',
    title: 'Pressure anomaly detected', workOrder: 'WO-48201',
    firedAt: _now - 4 * 3_600_000, acknowledged: true,
    decisions: [
      { workerId: 'tech-312', workerName: 'Omar Hassan',     workerRole: 'Senior Technician', distM: 1.0,
        channels: ['haptic','visual'], primary: 'haptic', acknowledged: true,
        reason: 'Stationary + high noise — haptic + visual (audio suppressed)',
        flags: ['High Stress','Elevated HR','Low SpO₂','Low Battery','89 dB'] },
      { workerId: 'tech-104', workerName: 'Ahmed Al-Rashidi', workerRole: 'Field Technician', distM: 5.4,
        channels: ['haptic','audio'], primary: 'haptic', acknowledged: true,
        reason: 'In motion + high noise — haptic primary, audio secondary',
        flags: ['86 dB'] },
    ],
  },
  {
    id: 'SEED-002', assetId: 'PANEL-07', severity: 'high', alertType: 'electrical',
    title: 'Electrical fault detected', workOrder: 'WO-48205',
    firedAt: _now - 2.5 * 3_600_000, acknowledged: true,
    decisions: [
      { workerId: 'tech-445', workerName: 'Fatima Al-Zahra', workerRole: 'Safety Officer',     distM: 0.5,
        channels: ['visual','audio'], primary: 'visual', acknowledged: true,
        reason: 'Stationary + low noise — visual primary, audio secondary',
        flags: [] },
      { workerId: 'tech-201', workerName: 'Sarah Mitchell',  workerRole: 'Equipment Specialist', distM: 3.2,
        channels: ['visual','audio'], primary: 'visual', acknowledged: true,
        reason: 'Stationary + low noise — visual primary, audio secondary',
        flags: [] },
    ],
  },
  {
    id: 'SEED-003', assetId: 'FURNACE-03', severity: 'critical', alertType: 'fire',
    title: 'Fire hazard detected', workOrder: 'WO-48210',
    firedAt: _now - 1.5 * 3_600_000, acknowledged: true,
    decisions: [
      { workerId: 'tech-312', workerName: 'Omar Hassan',     workerRole: 'Senior Technician', distM: 5.2,
        channels: ['haptic','visual'], primary: 'haptic', acknowledged: true,
        reason: 'Stationary + high noise — haptic + visual (audio suppressed)',
        flags: ['High Stress','Elevated HR','Low SpO₂','Low Battery','89 dB'] },
      { workerId: 'tech-445', workerName: 'Fatima Al-Zahra', workerRole: 'Safety Officer',    distM: 8.8,
        channels: ['visual','audio'], primary: 'visual', acknowledged: true,
        reason: 'Stationary + low noise — visual primary, audio secondary',
        flags: [] },
    ],
  },
  {
    id: 'SEED-004', assetId: 'COMPRESSOR-01', severity: 'moderate', alertType: 'pressure',
    title: 'Pressure anomaly detected', workOrder: 'WO-48215',
    firedAt: _now - 45 * 60_000, acknowledged: true,
    decisions: [
      { workerId: 'tech-445', workerName: 'Fatima Al-Zahra', workerRole: 'Safety Officer',     distM: 4.5,
        channels: ['visual','audio'], primary: 'visual', acknowledged: true,
        reason: 'Stationary + low noise — visual primary, audio secondary',
        flags: [] },
      { workerId: 'tech-201', workerName: 'Sarah Mitchell',  workerRole: 'Equipment Specialist', distM: 7.7,
        channels: ['visual','audio'], primary: 'visual', acknowledged: true,
        reason: 'Stationary + low noise — visual primary, audio secondary',
        flags: [] },
    ],
  },
];

interface SceneStore {
  workers: WorkerState[];
  updateWorkerSensors: (id: string, sensors: Partial<SensorData>) => void;
  addWorkerField:    (id: string, key: string) => void;
  removeWorkerField: (id: string, key: string) => void;

  alerts: Alert[];
  activeAlertAsset: string | null;

  machineAlertTypes: Record<string, MachineAlertType>;
  setMachineAlertType: (id: string, type: MachineAlertType) => void;

  focusTarget: string | null;
  setFocus: (id: string | null) => void;

  scenarioPhase: ScenarioPhase;
  setPhase: (p: ScenarioPhase) => void;

  showSNCard: boolean;
  snCardResolved: boolean;
  showRoutingCard: boolean;

  fireAlert: (assetId: string, severity: string) => void;
  acknowledgeAlert: () => void;
  resetScene: () => void;

  setWorkerEffect: (id: string, effect: Partial<WorkerEffect>) => void;
  setAllEffects: (effects: Partial<WorkerEffect>) => void;
}

export const useStore = create<SceneStore>((set, get) => ({
  workers: INITIAL_WORKERS,
  alerts: SEED_EVENTS,
  activeAlertAsset: null,
  focusTarget: null,
  scenarioPhase: 'idle',
  showSNCard: false,
  snCardResolved: false,
  showRoutingCard: false,

  machineAlertTypes: {
    'CENTRAL-REACTOR': 'pressure',
    'CHILLER-07':      'pressure',
    'PANEL-07':        'electrical',
    'FURNACE-03':      'fire',
    'COMPRESSOR-01':   'pressure',
  },

  setMachineAlertType: (id, type) =>
    set((s) => ({ machineAlertTypes: { ...s.machineAlertTypes, [id]: type } })),

  setFocus: (id) => set({ focusTarget: id }),

  setPhase: (p) => set({ scenarioPhase: p }),

  setWorkerEffect: (id, effect) =>
    set((s) => ({
      workers: s.workers.map((w) =>
        w.id === id ? { ...w, effects: { ...w.effects, ...effect } } : w
      ),
    })),

  setAllEffects: (effect) =>
    set((s) => ({
      workers: s.workers.map((w) => ({ ...w, effects: { ...w.effects, ...effect } })),
    })),

  updateWorkerSensors: (id, sensors) =>
    set((s) => ({
      workers: s.workers.map((w) => {
        if (w.id !== id) return w;
        const newSensors = { ...w.sensors, ...sensors };
        return { ...w, sensors: newSensors, routing: routeWorker(newSensors) };
      }),
    })),

  addWorkerField: (id, key) =>
    set((s) => ({
      workers: s.workers.map((w) => {
        if (w.id !== id || w.visibleFields.includes(key)) return w;
        const def = SENSOR_FIELD_DEFAULTS[key as keyof typeof SENSOR_FIELD_DEFAULTS];
        const newSensors = def !== undefined ? { ...w.sensors, [key]: def } : w.sensors;
        return { ...w, visibleFields: [...w.visibleFields, key], sensors: newSensors };
      }),
    })),

  removeWorkerField: (id, key) =>
    set((s) => ({
      workers: s.workers.map((w) =>
        w.id === id ? { ...w, visibleFields: w.visibleFields.filter((f) => f !== key) } : w
      ),
    })),

  fireAlert: (assetId, severity) => {
    const { machineAlertTypes, workers } = get();
    const alertType = machineAlertTypes[assetId] ?? 'pressure';
    const machinePos = MACHINE_POS[assetId];

    // Compute routing decisions for 2 closest workers
    const decisions: AlertDecision[] = workers
      .map((w) => {
        const wDef = WORKER_DEFS.find((d) => d.id === w.id)!;
        const dx   = wDef.position[0] - machinePos[0];
        const dz   = wDef.position[2] - machinePos[2];
        const dist = Math.round(Math.sqrt(dx * dx + dz * dz) * 10) / 10;
        const moving    = w.sensors.motion_state === 'Walking' || w.sensors.motion_state === 'Running';
        const highNoise = w.sensors.noise_level > 70;
        const routing   = w.routing;
        return {
          workerId: w.id, workerName: w.name, workerRole: w.role,
          channels: routing.channels, primary: routing.primary,
          reason: buildReason(moving, highNoise),
          distM: dist, acknowledged: false,
          flags: buildFlags(w.sensors),
        };
      })
      .sort((a, b) => a.distM - b.distM)
      .slice(0, 1);

    const alert: Alert = {
      id: `ALT-${Date.now()}`,
      assetId, severity, alertType,
      title: ALERT_TITLES[alertType],
      workOrder: WORK_ORDERS[assetId] ?? 'WO-48099',
      firedAt: Date.now(),
      acknowledged: false,
      decisions,
    };
    set((s) => ({
      alerts: [alert, ...s.alerts],
      activeAlertAsset: assetId,
      scenarioPhase: 'machine_fail',
      showSNCard: false,
      snCardResolved: false,
      showRoutingCard: false,
    }));
  },

  acknowledgeAlert: () => {
    const { workers } = get();
    set((s) => ({
      alerts: s.alerts.map((a, i) =>
        i === 0
          ? { ...a, acknowledged: true, decisions: a.decisions.map((d) => ({ ...d, acknowledged: true })) }
          : a
      ),
      scenarioPhase: 'acknowledged',
      showRoutingCard: false,
      snCardResolved: true,
      workers: workers.map((w) =>
        w.id === 'tech-104'
          ? { ...w, effects: { ...w.effects, ackArm: true, ringColor: '#22c55e', ringPulse: false } }
          : w
      ),
    }));
  },

  resetScene: () =>
    set((s) => ({
      alerts: SEED_EVENTS,
      activeAlertAsset: null,
      focusTarget: null,
      scenarioPhase: 'idle',
      showSNCard: false,
      snCardResolved: false,
      showRoutingCard: false,
      workers: INITIAL_WORKERS.map((w) => ({ ...w, effects: defaultEffects() })),
      machineAlertTypes: s.machineAlertTypes,
    })),
}));

// Dev convenience — exposes store actions on window for Playwright/testing
if (typeof window !== 'undefined') {
  (window as any).__ts = {
    setFocus:  (id: string | null) => useStore.getState().setFocus(id),
    fireAlert: (id: string, sev: string) => useStore.getState().fireAlert(id, sev),
    reset:     () => useStore.getState().resetScene(),
  };
}
