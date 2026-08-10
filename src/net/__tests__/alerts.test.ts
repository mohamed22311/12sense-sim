import { describe, expect, it } from 'vitest';
import { ALERT_TYPES } from '@/net/alerts';
import { FACTORY } from '@/sites/factory';
import { CONSTRUCTION } from '@/sites/construction';
import type { MachineKind, SiteDef } from '@/sites/types';

const KINDS: MachineKind[] = [
  'reactor',
  'chiller',
  'panel',
  'press',
  'packer',
  'furnace',
  'hoist',
  'crane',
  'generator',
  'pump',
  'welder',
];

const SITES: SiteDef[] = [FACTORY, CONSTRUCTION];

describe('ALERT_TYPES', () => {
  it('covers every machine kind', () => {
    for (const kind of KINDS) {
      expect(ALERT_TYPES[kind]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('offers a distinct vocabulary per kind', () => {
    // The point of per-kind presets is that a furnace and a packing line do
    // not raise the same alert. If two kinds ever share a whole message set,
    // the table has been filled in by copy rather than by thinking.
    const messageSets = KINDS.map((kind) =>
      ALERT_TYPES[kind].map((preset) => preset.message).join('|'),
    );
    expect(new Set(messageSets).size).toBe(KINDS.length);
  });

  it('leads with the most severe plausible failure', () => {
    // The dialog opens on the first preset, so it is what a hurried
    // demonstrator will send. It should not be the trivial one.
    const rank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
    for (const kind of KINDS) {
      const [first, ...rest] = ALERT_TYPES[kind];
      for (const other of rest) {
        expect(rank[first.severity]).toBeGreaterThanOrEqual(rank[other.severity]);
      }
    }
  });
});

describe.each(SITES)('$label as alertable assets', (site) => {
  it('gives every machine a preset list, so no machine opens an empty dialog', () => {
    for (const floor of site.floors) {
      for (const machine of floor.machines) {
        expect(ALERT_TYPES[machine.kind].length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps asset ids unique across the site', () => {
    // `asset_id` is what the server stores and a dispatcher matches against.
    // Two machines sharing one would make an alert ambiguous about its source.
    const ids = site.floors.flatMap((floor) => floor.machines.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the two sites together', () => {
  it('stand something of every modelled kind somewhere', () => {
    // Eleven bodies were built; a kind nobody stands on is one nobody sees.
    const used = new Set(
      SITES.flatMap((site) => site.floors.flatMap((f) => f.machines.map((m) => m.kind))),
    );
    expect([...used].sort()).toEqual([...KINDS].sort());
  });
});
