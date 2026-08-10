import type { SiteDef } from '@/sites/types';

/**
 * Two sunlit worlds, one per site.
 *
 * The scene used to be one dark slate palette for both, which made a factory
 * and a building site look like the same place at night. They are not the same
 * place, and neither is usually dark: a plant is lit and precise, a site is
 * open and dusty, and both are seen in daylight.
 *
 * So the palette is now a *theme*, chosen with the site, and the two are built
 * to differ in **temperature** before anything else — the factory cool and
 * clean, the construction site warm and sun-baked. That difference survives a
 * glance, a screenshot and a projector, which hue-only differences do not.
 *
 * What does not change between them is the discipline underneath. Each theme is
 * still a value ramp with the lit deck placed clearly above everything around
 * it, and saturation is still spent on the same three things: people, the
 * things people touch, and state that demands an answer. A brighter world is
 * not an excuse for a louder one.
 */

export type SiteTheme = {
  id: 'factory' | 'construction';

  /** Sky, and the colour the building is composited against. */
  sky: string;
  /** Distant haze, for the far end of the fog ramp. */
  haze: string;

  // Ground and surroundings
  ground: string;
  apron: string;
  /** Neighbouring structures, in three tones so a skyline is not one block. */
  neighbours: readonly [string, string, string];
  roadway: string;

  // Structure
  floor: string;
  floorDim: string;
  floorLine: string;
  wall: string;
  wallDim: string;
  ceiling: string;
  beam: string;
  plant: string;
  plantDim: string;
  structureBeam: string;
  structureBeamDim: string;

  // Plant and equipment
  machineBody: string;
  machineTrim: string;
  machinePanel: string;
  /** Hazard markings, rails, edges — the things people touch. */
  caution: string;

  // Light
  sunColor: string;
  sunIntensity: number;
  skyLight: string;
  groundBounce: string;
  ambient: string;
  ambientIntensity: number;
  /** Interior lamps read differently against a bright sky than a dark one. */
  lampColor: string;
  lampIntensity: number;
  /** How much of the environment probe reaches the materials. */
  envIntensity: number;
  exposure: number;
};

/** Shared across both worlds: people and signals do not change with the site. */
export const PEOPLE = {
  /** Two hi-vis colours, both real workwear. */
  vests: ['#ff6b2c', '#cfe01f'] as const,
  /** The colours a site actually issues hats in. */
  helmets: ['#f5c518', '#f2f4f7', '#3f8ede', '#e8552d'] as const,
  trousers: '#3c4a5c',
  boots: '#2f2a26',
  glove: '#37424f',
  /** Retroreflective tape. */
  band: '#f4f8fc',
  skin: ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#6b4226'] as const,
} as const;

/** Signals mean the same thing everywhere, so they are not themed. */
export const SIGNAL = {
  green: '#2f9e5f',
  amber: '#e5a020',
  red: '#d93a34',
  /** Alert modality chips. */
  haptic: '#7b6ad0',
  audio: '#c9761f',
  visual: '#2f7fd4',
  screen: '#0f2436',
  screenGlow: '#4da3ff',
} as const;

/**
 * A working plant at midday: cool, clean, precise.
 *
 * The light is high and slightly blue, the concrete is grey rather than sandy,
 * and the machines carry a saturated steel-teal that reads as painted
 * equipment. Everything about it is meant to feel maintained.
 */
export const FACTORY_THEME: SiteTheme = {
  id: 'factory',

  sky: '#a8c8e4',
  haze: '#c6dcef',

  ground: '#8b9099',
  apron: '#9aa0a8',
  neighbours: ['#9fb0c2', '#75828f', '#b6c4d1'],
  roadway: '#6f747c',

  floor: '#eef2f6',
  floorDim: '#7d8a99',
  floorLine: '#6f7c8a',
  wall: '#ccd4dd',
  wallDim: '#7f8c99',
  ceiling: '#bcc6d1',
  beam: '#8e9099',
  plant: '#aab4bf',
  plantDim: '#8b95a1',
  structureBeam: '#7e8b98',
  structureBeamDim: '#6a7683',

  machineBody: '#17738f',
  machineTrim: '#b7ccd8',
  machinePanel: '#154254',
  caution: '#f0b429',

  sunColor: '#fff2d6',
  sunIntensity: 2.15,
  skyLight: '#bcd6ee',
  groundBounce: '#7c848f',
  ambient: '#c3d6e8',
  ambientIntensity: 0.22,
  lampColor: '#ffeec4',
  lampIntensity: 0.34,
  envIntensity: 0.45,
  exposure: 0.94,
};

/**
 * A site in the sun: warm, dusty, unfinished.
 *
 * The same building, lit an hour later in the day and built of raw concrete
 * rather than finished panel. Plant is hire-fleet yellow at full strength,
 * because on a real site it is the most saturated thing in view and the demo
 * should agree.
 */
export const CONSTRUCTION_THEME: SiteTheme = {
  id: 'construction',

  sky: '#b8cfe0',
  haze: '#dcd6c4',

  ground: '#a3937a',
  apron: '#b0a189',
  neighbours: ['#bdae94', '#8a7f6b', '#d0c3a8'],
  roadway: '#7d7466',

  floor: '#ece5d4',
  floorDim: '#7d7563',
  floorLine: '#7a7261',
  wall: '#c9c1b1',
  wallDim: '#847c6c',
  ceiling: '#b6ae9e',
  beam: '#9b8f79',
  plant: '#b3ab99',
  plantDim: '#8f8776',
  structureBeam: '#8d8570',
  structureBeamDim: '#75705f',

  machineBody: '#2b6a86',
  machineTrim: '#c2c8ce',
  machinePanel: '#1f3d4d',
  caution: '#f5b400',

  sunColor: '#ffeaba',
  sunIntensity: 2.35,
  skyLight: '#c4d8ea',
  groundBounce: '#8f8062',
  ambient: '#ddd0b6',
  ambientIntensity: 0.24,
  lampColor: '#ffe7b0',
  lampIntensity: 0.3,
  envIntensity: 0.5,
  exposure: 0.96,
};

export function themeFor(site: SiteDef): SiteTheme {
  return site.id === 'construction' ? CONSTRUCTION_THEME : FACTORY_THEME;
}
