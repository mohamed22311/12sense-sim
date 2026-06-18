export const C = {
  // Environment — warm factory daylight
  bg:           '#c8b498',
  floor:        '#c4a864',
  floorLine:    '#a88c4a',
  wall:         '#f0e4cc',
  ceiling:      '#f4ecd8',
  beam:         '#c09060',

  // Machines — slate/teal industrial
  machineBody:  '#5a8090',
  machineTrim:  '#7aaab8',
  machinePanel: '#3a6070',
  caution:      '#f59e0b',

  // Workers
  hardhat:      '#ffcc00',
  vest:         '#ff6600',
  trousers:     '#546278',
  boots:        '#5a3a20',
  skin:         ['#c68642', '#8d5524', '#f1c27d', '#e0ac69', '#d4956a'] as const,

  // Lights & glow
  ceilingLight: '#fffbe8',
  windowGlow:   '#a8dcf8',
  watchGlow:    '#4e80cc',

  // Status LEDs
  ledGreen:     '#22c55e',
  ledAmber:     '#f59e0b',
  ledRed:       '#ef4444',

  // Alert modalities
  haptic:       '#7c62c8',
  audio:        '#c4742a',
  visual:       '#4e80cc',
  critical:     '#c44040',

  // Base rings
  ringNormal:   '#22c55e',
  ringAlert:    '#f59e0b',
  ringDanger:   '#ef4444',

  // Admin
  deskBody:     '#8a7a5a',
  monitorFrame: '#5a8090',
  monitorScreen:'#1a2a3a',
} as const;
