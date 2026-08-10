/**
 * Slate and brass.
 *
 * The palette is built on **value** rather than hue. Every structural surface —
 * sky, walls, slabs, plant, machines — sits on one cool blue-grey ramp from
 * near-black to pale, and the lit floor is placed three clear steps above
 * everything around it. That is what makes the eye land on the active floor
 * without anything having to be brightly coloured, and it is why the building
 * still reads correctly in a screenshot, on a projector, or to someone who
 * cannot distinguish red from green.
 *
 * Saturation is then spent deliberately and sparingly, on exactly three things:
 *
 * - **people**, in muted hi-vis, so a worker is the warmest thing on any floor;
 * - **brass**, on the things a person interacts with — hazard markings, rails,
 *   the accent in the interface;
 * - **signals**, on state that demands an answer — alarm, caution, healthy.
 *
 * Nothing else is allowed a strong hue. A floor of machines painted in
 * competing colours is what makes a scene look generated rather than designed:
 * the eye has nowhere to rest and no idea what matters.
 */

/**
 * The structural ramp, dark to light. Every neutral in the scene comes from
 * here, so surfaces relate to each other by construction rather than by taste.
 */
const SLATE = {
  900: '#1b212a',
  800: '#252d38',
  700: '#2e3742',
  600: '#3d4753',
  500: '#4e5967',
  400: '#667283',
  300: '#7d8590',
  200: '#98a1ac',
  100: '#b6bdc6',
  50: '#d7dbe0',
} as const;

export const C = {
  // Environment — a cool overcast sky the building reads against
  bg:           SLATE[700],
  /** The lit deck: the lightest large surface in the scene, by design. */
  floor:        SLATE[200],
  floorLine:    SLATE[400],
  wall:         SLATE[500],
  ceiling:      SLATE[600],
  /** Stair treads. Warm enough to read as a handled surface, cool enough not
      to compete with the people — it is the largest object on the west side. */
  beam:         '#6f6a61',

  // Dollhouse — an inactive floor recedes rather than disappearing, so an
  // alert firing up there is still visible as something worth going to look at.
  // Two full steps below the lit deck: enough to fall back, not enough to lose.
  floorDim:     SLATE[600],
  wallDim:      SLATE[700],
  plant:        SLATE[300],
  plantDim:     SLATE[500],

  /*
    Machines — decisively darker than the structure, not a shade.

    Once the environment probe lifted every surface, "a shade cooler" stopped
    separating anything: architecture and equipment resolved to the same
    blue-grey and the floors read as monotone. Plant now sits three ramp steps
    below the walls it stands against, so equipment reads as objects *on* a
    floor rather than as part of it — the same hue family, more conviction.
  */
  machineBody:  '#36465a',
  machineTrim:  '#93a0af',
  machinePanel: '#242f3d',
  /** Brass. Hazard markings, rails, edges — the things people touch. */
  caution:      '#c9a227',

  // Workers — the warmest thing on any floor, and the only warm thing at scale
  hardhat:      '#e8c547',
  vest:         '#e8763a',
  trousers:     '#3b4553',
  boots:        '#2b3038',
  /**
   * Skin tones spanning warm and cool undertones rather than one hue lightened,
   * which is what makes a crowd look like a crowd instead of one person
   * repeated at different exposures.
   */
  skin:         ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#6b4226'] as const,

  // Lights & glow
  ceilingLight: '#fff4d6',
  windowGlow:   '#9fc4d8',
  watchGlow:    '#5a8fd4',

  // Signals — the only strong hues in the scene, and they always mean state.
  // Red and green are deliberately separated in *value* as well as hue, so the
  // difference survives a colour-blind viewer and a bad projector.
  ledGreen:     '#5fa87f',
  ledAmber:     '#d9a13b',
  ledRed:       '#d64545',

  // Alert modalities — three hues that stay distinguishable at chip size
  haptic:       '#8b7cc8',
  audio:        '#c9873a',
  visual:       '#5a8fd4',
  critical:     '#c23b3b',

  // Base rings
  ringNormal:   '#5fa87f',
  ringAlert:    '#d9a13b',
  ringDanger:   '#d64545',

  // Admin
  deskBody:     '#5a6472',
  monitorFrame: '#4a5a6b',
  monitorScreen:'#151c25',
} as const;

/** Exposed so the interface can build on the same ramp as the scene. */
export const SLATE_RAMP = SLATE;
