import { beforeEach, describe, expect, it } from 'vitest';
import { useBuildingStore } from '@/state/buildingStore';
import { FACTORY } from '@/sites/factory';

describe('selectMachine', () => {
  beforeEach(() => {
    useBuildingStore.getState().reset();
  });

  it('opens the dialog and moves the camera to the machine’s floor', () => {
    // A machine is clickable on a dim floor, so selecting one has to bring
    // that floor forward — otherwise the dialog describes something the
    // operator cannot see.
    const machine = FACTORY.floors[3].machines[0];
    useBuildingStore.getState().selectMachine(machine.id);

    const state = useBuildingStore.getState();
    expect(state.selectedMachineId).toBe(machine.id);
    expect(state.activeFloorId).toBe(machine.floor);
  });

  it('ignores an id no machine has', () => {
    useBuildingStore.getState().selectMachine('NOT-A-MACHINE');
    expect(useBuildingStore.getState().selectedMachineId).toBeNull();
  });

  it('closes on null without disturbing the camera', () => {
    const machine = FACTORY.floors[4].machines[0];
    const store = useBuildingStore.getState();
    store.selectMachine(machine.id);
    store.selectMachine(null);

    const state = useBuildingStore.getState();
    expect(state.selectedMachineId).toBeNull();
    expect(state.activeFloorId).toBe(machine.floor);
  });
});

describe('open alerts', () => {
  beforeEach(() => {
    useBuildingStore.getState().reset();
  });

  it('starts empty and survives a reset', () => {
    const alert = { assetId: 'REACTOR-01', eventId: 'evt-1' };
    useBuildingStore.getState().setOpenAlerts([alert]);
    expect(useBuildingStore.getState().openAlerts).toEqual([alert]);

    useBuildingStore.getState().reset();
    expect(useBuildingStore.getState().openAlerts).toEqual([]);
  });

  it('pairs each asset with the event it raised', () => {
    // The event id is the whole point: without it the console cannot ask the
    // server whether the alert is still open, and the list becomes a record of
    // what this browser did rather than of what is actually happening.
    useBuildingStore.getState().setOpenAlerts([
      { assetId: 'REACTOR-01', eventId: 'evt-1' },
      { assetId: 'CHILLER-07', eventId: 'evt-2' },
    ]);
    const ids = useBuildingStore.getState().openAlerts.map((a) => a.eventId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('the site as the renderer sees it', () => {
  it('marks every machine footprint so it is not drawn twice', () => {
    // The navmesh needs a footprint under each machine; the renderer must not
    // draw it, or the machine stands inside a grey block.
    for (const floor of FACTORY.floors) {
      const machineFootprints = floor.obstacles.filter((o) => o.kind === 'machine');
      expect(machineFootprints.length).toBe(floor.machines.length);
    }
  });

  it('still hands pathing every obstacle, footprints included', () => {
    for (const floor of FACTORY.floors) {
      expect(floor.obstacles.length).toBeGreaterThan(floor.machines.length);
    }
  });
});
