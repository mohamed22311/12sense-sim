import { beforeEach, describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { isFloorActive, nextFloorId, useBuildingStore } from '@/state/buildingStore';

beforeEach(() => useBuildingStore.getState().reset());

describe('buildingStore', () => {
  it('starts on a real floor of the site', () => {
    const { activeFloorId } = useBuildingStore.getState();
    expect(FACTORY.floors.some((f) => f.id === activeFloorId)).toBe(true);
  });

  it('changes the active floor', () => {
    useBuildingStore.getState().setActiveFloor('4');
    expect(useBuildingStore.getState().activeFloorId).toBe('4');
  });

  it('ignores a floor the site does not have', () => {
    const before = useBuildingStore.getState().activeFloorId;
    useBuildingStore.getState().setActiveFloor('99');
    expect(useBuildingStore.getState().activeFloorId).toBe(before);
  });

  it('reports exactly one floor as active', () => {
    const active = FACTORY.floors.filter((f) => isFloorActive(f.id, '2'));
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('2');
  });

  it('steps up and down without falling off the ends', () => {
    expect(nextFloorId(FACTORY, '1', -1)).toBe('1');
    expect(nextFloorId(FACTORY, '6', +1)).toBe('6');
    expect(nextFloorId(FACTORY, '3', +1)).toBe('4');
    expect(nextFloorId(FACTORY, '3', -1)).toBe('2');
  });

  it('leaves an unknown floor alone when stepping', () => {
    expect(nextFloorId(FACTORY, 'nope', +1)).toBe('nope');
  });

  it('steps the active floor through the store', () => {
    useBuildingStore.getState().setActiveFloor('5');
    useBuildingStore.getState().stepFloor(+1);
    expect(useBuildingStore.getState().activeFloorId).toBe('6');
    useBuildingStore.getState().stepFloor(+1);
    expect(useBuildingStore.getState().activeFloorId).toBe('6');
  });

  it('tracks a focus target and clears it', () => {
    useBuildingStore.getState().setFocus('CHILLER-07');
    expect(useBuildingStore.getState().focus).toBe('CHILLER-07');
    useBuildingStore.getState().setFocus(null);
    expect(useBuildingStore.getState().focus).toBeNull();
  });

  it('carries a quality tier that can be overridden', () => {
    expect(useBuildingStore.getState().qualityTier).toBe('high');
    useBuildingStore.getState().setQualityTier('low');
    expect(useBuildingStore.getState().qualityTier).toBe('low');
  });
});
