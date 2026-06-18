import { useState, useEffect, useRef } from 'react';
import { Scene } from './scene/Scene';
import { useStore } from './state/store';
import type { SensorData } from './state/store';
import { useScenario } from './hooks/useScenario';
import './styles/global.css';

// All available sensor fields (core + optional)
const ALL_SENSOR_CFG = [
  { key: 'heart_rate'    as keyof SensorData, label: 'Heart Rate',   min: 40,   max: 200,   step: 1,    unit: 'bpm', dangerFn: (v: number) => v > 100  },
  { key: 'spo2'          as keyof SensorData, label: 'SpO₂',          min: 85,   max: 100,   step: 0.5,  unit: '%',   dangerFn: (v: number) => v < 95   },
  { key: 'stress_index'  as keyof SensorData, label: 'Stress',        min: 0,    max: 100,   step: 1,    unit: '',    dangerFn: (v: number) => v > 70   },
  { key: 'noise_level'   as keyof SensorData, label: 'Noise Level',   min: 20,   max: 110,   step: 1,    unit: 'dB',  dangerFn: (v: number) => v > 85   },
  { key: 'battery'       as keyof SensorData, label: 'Battery',       min: 0,    max: 100,   step: 1,    unit: '%',   dangerFn: (v: number) => v < 15   },
  { key: 'hrv'           as keyof SensorData, label: 'HRV',            min: 10,   max: 100,   step: 1,    unit: 'ms',  dangerFn: () => false              },
  { key: 'skin_temp'     as keyof SensorData, label: 'Skin Temp',      min: 34,   max: 40,    step: 0.1,  unit: '°C',  dangerFn: (v: number) => v > 38.5 },
  { key: 'steps'         as keyof SensorData, label: 'Steps',          min: 0,    max: 20000, step: 100,  unit: '',    dangerFn: () => false              },
  { key: 'ecg'           as keyof SensorData, label: 'ECG Amp',        min: -1,   max: 1,     step: 0.01, unit: 'mV',  dangerFn: () => false              },
];

const MACHINE_IDS = ['CENTRAL-REACTOR'];
const MACHINE_LABELS: Record<string, string> = {
  'CENTRAL-REACTOR': 'Central Process Reactor',
};

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
const ALERT_TYPE_ICONS: Record<string, string> = {
  fire: '🔥', electrical: '⚡', pressure: '🔧',
};
const MODALITY_COLORS: Record<string, string> = {
  haptic: '#7c62c8', audio: '#c4742a', visual: '#4e80cc',
};

// ─── Alert beep (Web Audio) ───────────────────────────────────────────────
function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => ctx.close();
  } catch (_) { /* ignore in environments without AudioContext */ }
}

// ─── Voice synthesis (picks best available voice) ─────────────────────────
function speakAlert(text: string) {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();

  const doSpeak = () => {
    const voices = synth.getVoices();
    const u = new SpeechSynthesisUtterance(text);
    // Prefer richer Google/Microsoft voices over robotic offline fallbacks
    const best =
      voices.find((v) => v.name === 'Google US English') ||
      voices.find((v) => v.name === 'Google UK English Female') ||
      voices.find((v) => v.name.includes('Microsoft Zira')) ||
      voices.find((v) => v.name.includes('Microsoft David')) ||
      voices.find((v) => v.name.startsWith('Google') && v.lang.startsWith('en')) ||
      voices.find((v) => v.name.startsWith('Microsoft') && v.lang.startsWith('en')) ||
      voices.find((v) => v.lang === 'en-US');
    if (best) u.voice = best;
    u.rate = 0.88; u.pitch = 1.05; u.volume = 1.0;
    synth.speak(u);
  };

  if (synth.getVoices().length > 0) {
    doSpeak();
  } else {
    synth.addEventListener('voiceschanged', doSpeak, { once: true });
  }
}


// ─── Machine sidebar ──────────────────────────────────────────────────────
function MachineSidebar({ id }: { id: string }) {
  const setFocus            = useStore((s) => s.setFocus);
  const fireAlert           = useStore((s) => s.fireAlert);
  const resetScene          = useStore((s) => s.resetScene);
  const scenarioPhase       = useStore((s) => s.scenarioPhase);
  const machineAlertTypes   = useStore((s) => s.machineAlertTypes);
  const setMachineAlertType = useStore((s) => s.setMachineAlertType);
  const alerts              = useStore((s) => s.alerts);

  const isRunning   = scenarioPhase !== 'idle' && scenarioPhase !== 'acknowledged';
  const latestAlert = alerts[0] ?? null;
  const thisAlert   = latestAlert?.assetId === id ? latestAlert : null;

  return (
    <div className="machine-sidebar">
      <div className="msb-label">{MACHINE_LABELS[id]}</div>
      <div className="msb-name">{id}</div>

      <div className={`msb-status ${isRunning && thisAlert ? 'alert' : 'ok'}`}>
        {isRunning && thisAlert ? '⚠ ALERT ACTIVE' : '● NORMAL'}
      </div>

      <div className="msb-section">Alert Type</div>
      <div className="msb-type-group">
        {(['fire', 'electrical', 'pressure'] as const).map((t) => (
          <button key={t}
            className={`msb-type-btn${machineAlertTypes[id] === t ? ` active-${t}` : ''}`}
            onClick={() => setMachineAlertType(id, t)}>
            {ALERT_TYPE_ICONS[t]} {t}
          </button>
        ))}
      </div>

      <button className="msb-fire-btn" disabled={isRunning}
        onClick={() => { fireAlert(id, 'critical'); setFocus(null); }}>
        {isRunning ? 'Alert in progress…' : `Fire ${ALERT_TYPE_ICONS[machineAlertTypes[id]]} Alert`}
      </button>

      {thisAlert && (
        <div style={{ marginTop: 10, fontSize: 10, color: '#7a8fa8', lineHeight: 1.6 }}>
          WO: {thisAlert.workOrder}<br />
          <span style={{ color: thisAlert.acknowledged ? '#4ade80' : '#e87070', fontWeight: 700 }}>
            {thisAlert.acknowledged ? 'Acknowledged ✓' : 'Awaiting acknowledgment…'}
          </span>
        </div>
      )}

      {(isRunning || scenarioPhase === 'acknowledged') && (
        <button className="ctrl-btn" style={{ width: '100%', marginTop: 10, textAlign: 'center' }}
          onClick={() => { resetScene(); setFocus(null); }}>
          ↺ Reset Scene
        </button>
      )}
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────
function StatTile({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className={`mk-stat ${color}`}>
      <div className="mk-stat-value">{value}</div>
      <div className="mk-stat-label">{label}</div>
    </div>
  );
}

// ─── Worker panel (medkit style, with sliders + voice) ────────────────────
function WorkerPanel({
  workerId, muted, onClose,
}: { workerId: string; muted: boolean; onClose: () => void }) {
  const [tab, setTab]             = useState<'sensors' | 'routing' | 'alerts'>('sensors');
  const [sent, setSent]           = useState(false);
  const [showAddField, setShowAddField] = useState(false);

  // Drag-to-move state: null = default right-side anchor, otherwise {x,y} = fixed left/top
  const [pos, setPos]    = useState<{ x: number; y: number } | null>(null);
  const panelRef         = useRef<HTMLDivElement>(null);
  const dragging         = useRef(false);
  const dragOff          = useRef({ x: 0, y: 0 });

  // Register global mouse handlers for dragging
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - dragOff.current.x, y: e.clientY - dragOff.current.y });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragging.current = true;
    dragOff.current  = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  };

  const worker           = useStore((s) => s.workers.find((w) => w.id === workerId));
  const updateSensors    = useStore((s) => s.updateWorkerSensors);
  const acknowledgeAlert = useStore((s) => s.acknowledgeAlert);
  const addWorkerField   = useStore((s) => s.addWorkerField);
  const removeWorkerField = useStore((s) => s.removeWorkerField);
  const alerts           = useStore((s) => s.alerts);

  // Local sensor values for editing
  const [localSensors, setLocalSensors] = useState<Partial<SensorData>>({});
  const [dirty, setDirty] = useState(false);

  // Init local sensors when worker changes
  useEffect(() => {
    if (worker) { setLocalSensors({ ...worker.sensors }); setDirty(false); }
  }, [workerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const latestAlert = alerts[0] ?? null;
  const hasAlert    = !!latestAlert && !latestAlert.acknowledged;

  // Play voice when panel opens with an active alert
  useEffect(() => {
    if (!hasAlert || muted || !worker) return;
    const alertType = latestAlert?.alertType ?? 'pressure';
    const assetName = latestAlert?.assetId?.replace('-', ' ') ?? 'unknown';
    speakAlert(
      `Attention, ${worker.name.split(' ')[0]}. ${latestAlert?.title}. ` +
      `Alert type: ${alertType}. Asset: ${assetName}. ` +
      `This is a critical event. Please respond immediately and acknowledge.`
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!worker) return null;
  const { sensors, routing, effects } = worker;

  // Merge local values with store (show local edits)
  const display = { ...sensors, ...localSensors };

  const updateLocal = (key: keyof SensorData, v: number) => {
    if (key === 'motion_state') return;
    setLocalSensors((prev) => ({ ...prev, [key]: v }));
    setDirty(true);
  };

  const handleSend = () => {
    updateSensors(workerId, localSensors);
    setSent(true);
    setDirty(false);
    setTimeout(() => setSent(false), 2500);
  };

  const hrColor     = (display.heart_rate   ?? 0) > 100 ? 'red'    : 'pink';
  const spo2Color   = (display.spo2         ?? 0) < 95  ? 'red'    : 'teal';
  const stressColor = (display.stress_index ?? 0) > 70  ? 'salmon' : 'gold';
  const batColor    = (display.battery      ?? 0) < 15  ? 'red'    : (display.battery ?? 0) < 40 ? 'salmon' : 'green';

  // Compute visible and addable field configs
  const visibleFieldCfg  = ALL_SENSOR_CFG.filter((f) => worker.visibleFields.includes(f.key as string));
  const addableFieldCfg  = ALL_SENSOR_CFG.filter((f) => !worker.visibleFields.includes(f.key as string));

  // Panel position: default anchors right side; after dragging, uses left/top
  const panelStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, zIndex: 300 }
    : { position: 'fixed', right: 20, top: '50%', transform: 'translateY(-50%)', zIndex: 300 };

  return (
    <div
      ref={panelRef}
      className="mk-panel"
      style={{ ...panelStyle, width: 440 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header — drag handle */}
      <div
        className="mk-header"
        style={{ cursor: dragging.current ? 'grabbing' : 'grab', userSelect: 'none' }}
        onMouseDown={onHeaderMouseDown}
      >
        <span style={{ fontSize: 13, color: '#9a8a78', marginRight: 2, flexShrink: 0 }}>⠿</span>
        <span className="mk-title">{worker.name}</span>
        <span className="mk-badge role">{worker.role}</span>
        {(effects.dangerFlag || hasAlert)
          ? <span className="mk-badge alert">⌚ Alert</span>
          : <span className="mk-badge ok">● Active</span>
        }
        <button className="mk-close" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>✕ Close</button>
      </div>

        {/* Stats */}
        <div className="mk-stats">
          <StatTile value={`${display.heart_rate ?? sensors.heart_rate}`}    label="Heart Rate" color={hrColor} />
          <StatTile value={`${display.spo2 ?? sensors.spo2}%`}               label="SpO₂"       color={spo2Color} />
          <StatTile value={`${display.stress_index ?? sensors.stress_index}`} label="Stress"    color={stressColor} />
          <StatTile value={`${display.battery ?? sensors.battery}%`}          label="Battery"   color={batColor} />
          <StatTile value={sensors.motion_state.slice(0, 4)}                   label="Motion"   color="blue" />
        </div>

        {/* Tabs */}
        <div className="mk-tabs">
          {(['sensors', 'routing', 'alerts'] as const).map((t) => (
            <button key={t} className={`mk-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'sensors' ? '📡 Sensors' : t === 'routing' ? '🔀 Routing' : `🔔 Alerts${hasAlert ? ' •' : ''}`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="mk-content">

          {tab === 'sensors' && (
            <>
              {hasAlert && (
                <div className="mk-alert-banner">
                  <div className="mk-alert-icon">{ALERT_TYPE_ICONS[latestAlert!.alertType]}</div>
                  <div>
                    <div className="mk-alert-title">{latestAlert!.title}</div>
                    <div className="mk-alert-sub">{latestAlert!.assetId} · {latestAlert!.severity.toUpperCase()}</div>
                  </div>
                  <button className="mk-alert-btn" onClick={acknowledgeAlert}>ACK</button>
                </div>
              )}

              {/* Editable sliders — only visible fields */}
              {visibleFieldCfg.map(({ key, label, min, max, step, unit, dangerFn }) => {
                const rawVal = display[key as keyof typeof display];
                const val    = typeof rawVal === 'number' ? rawVal : 0;
                const isDanger = dangerFn(val);
                return (
                  <div key={key as string} className="mk-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="mk-row-dot" style={{ background: isDanger ? '#c44040' : '#1a8040' }} />
                        <span className="mk-row-label">{label}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={`mk-row-badge ${isDanger ? 'danger' : 'ok'}`}>
                          {step < 1 ? val.toFixed(1) : Math.round(val)}{unit}
                        </span>
                        <button
                          title="Remove field"
                          style={{ width: 16, height: 16, borderRadius: 3, border: 'none', background: 'rgba(196,64,64,0.18)', color: '#e87070', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => removeWorkerField(workerId, key as string)}
                        >✕</button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={min} max={max} step={step}
                      value={val}
                      className="mk-slider"
                      onChange={(e) => updateLocal(key as keyof SensorData, parseFloat(e.target.value))}
                    />
                  </div>
                );
              })}

              {/* Motion state selector — always visible */}
              <div className="mk-row" style={{ gap: 8 }}>
                <div className="mk-row-dot" style={{ background: '#1040a0' }} />
                <span className="mk-row-label" style={{ flex: 1 }}>Motion State</span>
                <select className="mk-select"
                  value={display.motion_state ?? sensors.motion_state}
                  onChange={(e) => {
                    setLocalSensors((p) => ({ ...p, motion_state: e.target.value as SensorData['motion_state'] }));
                    setDirty(true);
                  }}>
                  {(['Walking','Running','Stationary','Resting'] as const).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Add field button + dropdown */}
              <div style={{ position: 'relative', marginTop: 4 }}>
                <button
                  className="mk-send-btn"
                  style={{ background: '#10253a', fontSize: 11, padding: '6px 12px' }}
                  onClick={() => setShowAddField((v) => !v)}
                >
                  + Add Field
                </button>
                {showAddField && (
                  <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, background: '#121e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 4, zIndex: 20, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                    {addableFieldCfg.length === 0 ? (
                      <div style={{ padding: '5px 10px', fontSize: 11, color: '#4a6070' }}>All fields added</div>
                    ) : addableFieldCfg.map(({ key, label }) => (
                      <div
                        key={key as string}
                        style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderRadius: 4, color: '#8ab0c8' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        onClick={() => { addWorkerField(workerId, key as string); setShowAddField(false); }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button className={`mk-send-btn${sent ? ' sent' : ''}`} disabled={sent}
                onClick={handleSend}>
                {sent ? '✓ Data Sent to System' : dirty ? '📤 Send Updated Data' : '📤 Send Watch Data'}
              </button>
            </>
          )}

          {tab === 'routing' && (
            <>
              <div className="mk-row">
                <div className="mk-row-dot" style={{ background: MODALITY_COLORS[routing.primary] }} />
                <span className="mk-row-label">Primary Channel</span>
                <span className="mk-row-badge info">{routing.primary.toUpperCase()}</span>
              </div>
              {routing.channels.map((ch) => (
                <div key={ch} className="mk-row">
                  <div className="mk-row-dot" style={{ background: MODALITY_COLORS[ch] }} />
                  <span className="mk-row-label">{ch.charAt(0).toUpperCase() + ch.slice(1)} Alert</span>
                  <span className="mk-row-badge ok">ACTIVE</span>
                </div>
              ))}
              {routing.suppressed.map((ch) => (
                <div key={ch} className="mk-row">
                  <div className="mk-row-dot" style={{ background: '#888' }} />
                  <span className="mk-row-label">{ch.charAt(0).toUpperCase() + ch.slice(1)} Alert</span>
                  <span className="mk-row-badge danger">SUPPRESSED</span>
                </div>
              ))}
              <div className="mk-row" style={{ marginTop: 4 }}>
                <div className="mk-row-dot" style={{ background: '#5a5040' }} />
                <span className="mk-row-label">Context: {sensors.motion_state}</span>
                <span className="mk-row-value">{sensors.noise_level} dB</span>
              </div>
            </>
          )}

          {tab === 'alerts' && (
            <>
              {!latestAlert && (
                <div className="mk-row">
                  <div className="mk-row-dot" style={{ background: '#1a8040' }} />
                  <span className="mk-row-label">No active alerts</span>
                  <span className="mk-row-badge ok">CLEAR</span>
                </div>
              )}
              {latestAlert && (
                <>
                  <div className="mk-alert-banner">
                    <div className="mk-alert-icon">{ALERT_TYPE_ICONS[latestAlert.alertType]}</div>
                    <div>
                      <div className="mk-alert-title">{latestAlert.title}</div>
                      <div className="mk-alert-sub">{latestAlert.assetId} · WO: {latestAlert.workOrder}</div>
                    </div>
                    {!latestAlert.acknowledged && (
                      <button className="mk-alert-btn" onClick={acknowledgeAlert}>ACK</button>
                    )}
                  </div>
                  <div className="mk-row">
                    <div className="mk-row-dot" style={{ background: latestAlert.acknowledged ? '#1a8040' : '#c44040' }} />
                    <span className="mk-row-label">Status</span>
                    <span className={`mk-row-badge ${latestAlert.acknowledged ? 'ok' : 'danger'}`}>
                      {latestAlert.acknowledged ? 'Acknowledged' : 'OPEN'}
                    </span>
                  </div>
                  <div className="mk-row">
                    <div className="mk-row-dot" style={{ background: '#5a4a38' }} />
                    <span className="mk-row-label">Severity</span>
                    <span className="mk-row-badge warn">{latestAlert.severity.toUpperCase()}</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
    </div>
  );
}

// ─── Severity badge class helper ─────────────────────────────────────────
function sevClass(sev: string) {
  if (sev === 'critical') return 'danger';
  if (sev === 'high')     return 'warn';
  return 'info';
}

// ─── Admin dashboard panel ────────────────────────────────────────────────
function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'workers' | 'machines' | 'events'>('overview');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const workers        = useStore((s) => s.workers);
  const alerts         = useStore((s) => s.alerts);
  const isRunning      = useStore((s) => s.scenarioPhase !== 'idle' && s.scenarioPhase !== 'acknowledged');
  const machineAlertTypes = useStore((s) => s.machineAlertTypes);
  const acknowledgeAlert = useStore((s) => s.acknowledgeAlert);

  const activeAlerts  = alerts.filter((a) => !a.acknowledged).length;
  const criticalCount = alerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length;
  const avgHR   = workers.length ? Math.round(workers.reduce((s, w) => s + w.sensors.heart_rate, 0) / workers.length) : 0;
  const avgSpO2 = workers.length ? (workers.reduce((s, w) => s + w.sensors.spo2, 0) / workers.length).toFixed(1) : '0';
  const atRisk  = workers.filter((w) => w.effects.dangerFlag || w.sensors.battery < 15 || w.sensors.spo2 < 95).length;

  return (
    <div className="mk-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk-panel" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="mk-header">
          <span className="mk-title">Control Room</span>
          <span className="mk-badge live">● LIVE</span>
          {activeAlerts > 0 && <span className="mk-badge alert">{activeAlerts} Alert{activeAlerts > 1 ? 's' : ''}</span>}
          <button className="mk-close" onClick={onClose}>✕ Close</button>
        </div>

        {/* Stats */}
        <div className="mk-stats">
          <StatTile value={`${activeAlerts}`}    label="Active Alerts"  color={activeAlerts > 0 ? 'red' : 'green'} />
          <StatTile value={`${workers.length}`}  label="Workers Online" color="teal" />
          <StatTile value={`${atRisk}`}          label="At Risk"        color={atRisk > 0 ? 'salmon' : 'green'} />
          <StatTile value={`${avgHR}`}           label="Avg HR (bpm)"   color={avgHR > 100 ? 'red' : 'pink'} />
          <StatTile value={`${avgSpO2}%`}        label="Avg SpO₂"       color="teal" />
          <StatTile value={`${criticalCount}`}   label="Critical"       color={criticalCount > 0 ? 'red' : 'green'} />
        </div>

        {/* Tabs */}
        <div className="mk-tabs">
          {(['overview', 'workers', 'machines', 'events'] as const).map((t) => (
            <button key={t} className={`mk-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'overview' ? '🏭 Overview' : t === 'workers' ? '👷 Workers' : t === 'machines' ? '⚙ Machines' : `📋 Events${alerts.length ? ` (${alerts.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="mk-content">
          {tab === 'overview' && (
            <>
              {alerts.filter((a) => !a.acknowledged).map((a) => (
                <div key={a.id} className="mk-alert-banner">
                  <div className="mk-alert-icon">{ALERT_TYPE_ICONS[a.alertType]}</div>
                  <div>
                    <div className="mk-alert-title">{a.title}</div>
                    <div className="mk-alert-sub">Asset: {a.assetId} · WO: {a.workOrder}</div>
                  </div>
                  <button className="mk-alert-btn" onClick={acknowledgeAlert}>ACK</button>
                </div>
              ))}

              {/* Factory stats rows — no phase/facility status */}
              {[
                ['Workers Active',   `${workers.length} / ${workers.length}`,                                                                      'green',                                                                                                        workers.length > 0],
                ['Avg Heart Rate',   `${avgHR} bpm`,                                                                                               avgHR > 100 ? 'danger' : 'ok',                                                                                  avgHR > 100],
                ['Avg SpO₂',         `${avgSpO2}%`,                                                                                                'ok',                                                                                                           false],
                ['Active Alerts',    `${activeAlerts}`,                                                                                             activeAlerts > 0 ? 'danger' : 'ok',                                                                             activeAlerts > 0],
                ['Acknowledged',     `${alerts.filter((a) => a.acknowledged).length}`,                                                             'ok',                                                                                                           false],
                ['Avg Noise Level',  `${Math.round(workers.reduce((s, w) => s + w.sensors.noise_level,   0) / (workers.length || 1))} dB`,         'info',                                                                                                         false],
                ['Avg Stress Index', `${Math.round(workers.reduce((s, w) => s + w.sensors.stress_index,  0) / (workers.length || 1))}`,            Math.round(workers.reduce((s, w) => s + w.sensors.stress_index, 0) / (workers.length || 1)) > 70 ? 'danger' : 'ok', false],
              ].map(([label, value, badgeClass]) => (
                <div key={label as string} className="mk-row">
                  <div className="mk-row-dot" style={{ background: badgeClass === 'danger' ? '#c44040' : badgeClass === 'warn' ? '#b05000' : '#1a8040' }} />
                  <span className="mk-row-label">{label}</span>
                  <span className={`mk-row-badge ${badgeClass}`}>{value}</span>
                </div>
              ))}
            </>
          )}

          {tab === 'workers' && workers.map((w) => (
            <div key={w.id} className="mk-row">
              <div className="mk-row-dot" style={{
                background: w.effects.dangerFlag ? '#c44040' : w.sensors.battery < 15 ? '#c44040' : '#1a8040'
              }} />
              <div style={{ flex: 1 }}>
                <div className="mk-row-label">{w.name}</div>
                <div style={{ fontSize: 10, color: '#5a4a38', marginTop: 1 }}>
                  {w.role} · HR {w.sensors.heart_rate} bpm · SpO₂ {w.sensors.spo2}% · 🔋 {w.sensors.battery}%
                </div>
              </div>
              <span className={`mk-row-badge ${w.effects.dangerFlag ? 'danger' : 'ok'}`}>
                {w.sensors.motion_state}
              </span>
            </div>
          ))}

          {tab === 'machines' && MACHINE_IDS.map((mid) => (
            <div key={mid} className="mk-row">
              <div className="mk-row-dot" style={{ background: isRunning && alerts[0]?.assetId === mid ? '#c44040' : '#1a8040' }} />
              <div style={{ flex: 1 }}>
                <div className="mk-row-label">{mid}</div>
                <div style={{ fontSize: 10, color: '#5a4a38', marginTop: 1 }}>
                  {MACHINE_LABELS[mid]} · Type: {machineAlertTypes[mid]} monitoring
                </div>
              </div>
              <span className={`mk-row-badge ${isRunning && alerts[0]?.assetId === mid ? 'danger' : 'ok'}`}>
                {isRunning && alerts[0]?.assetId === mid ? 'ALERT' : 'NORMAL'}
              </span>
            </div>
          ))}

          {tab === 'events' && (
            <>
              {alerts.length === 0 && (
                <div className="mk-row">
                  <div className="mk-row-dot" style={{ background: '#1a8040' }} />
                  <span className="mk-row-label">No events recorded</span>
                  <span className="mk-row-badge ok">CLEAR</span>
                </div>
              )}
              {alerts.map((a) => (
                <div key={a.id} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 7, marginBottom: 8, overflow: 'hidden' }}>
                  {/* Event header — click to expand */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', cursor: 'pointer', background: expandedIds.has(a.id) ? 'rgba(255,255,255,0.03)' : 'transparent' }}
                    onClick={() => toggleExpand(a.id)}
                  >
                    <span className={`mk-row-badge ${sevClass(a.severity)}`}>{a.severity.toUpperCase()}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{ALERT_TYPE_ICONS[a.alertType]} {a.title}</div>
                      <div style={{ fontSize: 10, color: '#5a7080', marginTop: 1 }}>{a.assetId} · WO: {a.workOrder} · {relTime(a.firedAt)}</div>
                    </div>
                    {a.decisions.length > 0 && (
                      <span className="mk-row-badge info" style={{ flexShrink: 0 }}>{a.decisions.length} notified</span>
                    )}
                    <span className={`mk-row-badge ${a.acknowledged ? 'ok' : 'danger'}`} style={{ flexShrink: 0 }}>{a.acknowledged ? 'ACK' : 'OPEN'}</span>
                    <span style={{ color: '#4a6a80', fontSize: 10, flexShrink: 0 }}>{expandedIds.has(a.id) ? '▼' : '▶'}</span>
                  </div>

                  {/* Expanded routing decisions */}
                  {expandedIds.has(a.id) && (
                    <div style={{ padding: '8px 13px 12px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {a.decisions.length === 0 ? (
                        <div style={{ fontSize: 11, color: '#4a6070' }}>No workers were in range at time of alert.</div>
                      ) : a.decisions.map((d) => (
                        <div key={d.workerId} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 5, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                            <div style={{ width: 26, height: 26, borderRadius: 5, background: 'rgba(78,128,204,0.18)', color: '#6090cc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0, letterSpacing: '-0.3px' }}>
                              {d.workerName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{d.workerName}</div>
                              <div style={{ fontSize: 10, color: '#5a7080' }}>{d.workerRole} · {d.distM.toFixed(1)} m from asset</div>
                            </div>
                            <span className={`mk-row-badge ${d.acknowledged ? 'ok' : 'danger'}`} style={{ flexShrink: 0 }}>
                              {d.acknowledged ? 'ACK' : 'PENDING'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                            {d.channels.map((ch) => (
                              <span key={ch} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: MODALITY_COLORS[ch] + '28', color: MODALITY_COLORS[ch], border: `1px solid ${MODALITY_COLORS[ch]}40`, fontWeight: 600 }}>
                                {ch.charAt(0).toUpperCase() + ch.slice(1)}
                              </span>
                            ))}
                            {d.flags.map((flag) => (
                              <span key={flag} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(196,64,64,0.14)', color: '#d08080', border: '1px solid rgba(196,64,64,0.2)' }}>
                                {flag}
                              </span>
                            ))}
                          </div>
                          <div style={{ fontSize: 10, color: '#3a5060', fontStyle: 'italic' }}>{d.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────
export default function App() {
  useScenario();

  const [muted, setMuted] = useState(false);

  const focusTarget      = useStore((s) => s.focusTarget);
  const setFocus         = useStore((s) => s.setFocus);
  const scenarioPhase    = useStore((s) => s.scenarioPhase);
  const resetScene       = useStore((s) => s.resetScene);
  const acknowledgeAlert = useStore((s) => s.acknowledgeAlert);
  const workers          = useStore((s) => s.workers);
  const alerts           = useStore((s) => s.alerts);

  // Auto-focus camera on the receiving worker's watch when alert reaches them
  useEffect(() => {
    if (scenarioPhase === 'alerting') {
      const active = alerts.find((a) => !a.acknowledged);
      if (active?.decisions[0]) {
        setFocus(active.decisions[0].workerId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioPhase]);

  // Play beep + voice when alert is delivered — only for the ONE worker with audio channel
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  useEffect(() => {
    if (scenarioPhase !== 'alerting') return;
    if (mutedRef.current) return;
    const active = alerts.find((a) => !a.acknowledged);
    if (!active) return;
    // First decision with an audio channel gets the sound; others are silent
    const audioDecision = active.decisions.find((d) => d.channels.includes('audio'));
    if (!audioDecision) return;
    playBeep();
    const id = setTimeout(
      () => speakAlert(`Alert. ${active.title} at ${active.assetId}. ${audioDecision.workerName}, please respond.`),
      650,
    );
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioPhase]);

  const isRunning      = scenarioPhase !== 'idle' && scenarioPhase !== 'acknowledged';
  const focusedWorker  = focusTarget ? workers.find((w) => w.id === focusTarget) : undefined;
  const focusedMachine = focusTarget && !focusedWorker && MACHINE_IDS.includes(focusTarget) ? focusTarget : null;
  const isAdmin        = focusTarget === 'admin';

  return (
    <>
      <Scene />

      {/* Minimal controls */}
      <div className="controls-strip">
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.42)', letterSpacing: '0.07em', pointerEvents: 'none' }}>
          TWELVE SENSES
        </div>
        {(isRunning || scenarioPhase === 'acknowledged') && (
          <button className="ctrl-btn danger" onClick={() => { resetScene(); setFocus(null); }}>↺ Reset</button>
        )}
        <button className="ctrl-btn mute" title={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Acknowledge */}
      {scenarioPhase === 'alerting' && (
        <button className="ack-btn" onClick={acknowledgeAlert}>⌚ Acknowledge Alert</button>
      )}

      {/* Machine sidebar */}
      {focusedMachine && <MachineSidebar id={focusedMachine} />}

      {/* Worker panel */}
      {focusedWorker && (
        <WorkerPanel workerId={focusedWorker.id} muted={muted} onClose={() => setFocus(null)} />
      )}

      {/* Admin panel */}
      {isAdmin && <AdminPanel onClose={() => setFocus(null)} />}

      {/* Legend */}
      <div className="legend">
        {([['Haptic', '#7c62c8'], ['Audio', '#c4742a'], ['Visual', '#4e80cc'], ['Critical', '#c44040'], ['OK', '#22c55e']] as [string, string][]).map(([label, color]) => (
          <div key={label} className="legend-item">
            <div className="legend-dot" style={{ background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
