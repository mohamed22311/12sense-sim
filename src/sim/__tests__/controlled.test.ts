import { describe, expect, it } from 'vitest';
import { CONTROL_SPEED, createControlledAgent } from '@/sim/controlled';
import { buildGrid } from '@/sim/navmesh';
import { FACTORY } from '@/sites/factory';

const grids = new Map(FACTORY.floors.map((f) => [f.id, buildGrid(f)]));

const driver = (start = { x: 0, z: -2 }) =>
  createControlledAgent({
    index: 1,
    site: FACTORY,
    grids,
    start: { floorId: '1', position: { ...start } },
  });

describe('the driven worker', () => {
  it('stands still with no input', () => {
    const agent = driver();
    agent.tick(1000);
    expect(agent.state.movedThisTick).toBe(0);
    expect(agent.state.activity).toBe('resting');
  });

  it('walks at the stated speed', () => {
    const agent = driver();
    agent.setInput({ x: 1, z: 0 });
    agent.tick(1000);
    expect(agent.state.position.x).toBeCloseTo(CONTROL_SPEED, 5);
    expect(agent.state.activity).toBe('walking');
  });

  it('does not walk faster diagonally', () => {
    // Two full-magnitude axes would otherwise carry him 41% further than a
    // straight line, which is the oldest bug in character movement.
    const straight = driver();
    straight.setInput({ x: 1, z: 0 });
    straight.tick(1000);

    const diagonal = driver();
    diagonal.setInput({ x: 1, z: 1 });
    diagonal.tick(1000);

    const straightDistance = Math.hypot(
      straight.state.position.x,
      straight.state.position.z + 2,
    );
    const diagonalDistance = Math.hypot(
      diagonal.state.position.x,
      diagonal.state.position.z + 2,
    );
    expect(diagonalDistance).toBeCloseTo(straightDistance, 5);
  });

  it('reports how far it actually moved, not how far it was pushed', () => {
    // Physiology reads `movedThisTick`, so a worker held against a machine
    // must not accumulate heart rate for walking he did not do.
    const agent = driver();
    agent.setInput({ x: 1, z: 0 });
    agent.tick(500);
    expect(agent.state.movedThisTick).toBeCloseTo(CONTROL_SPEED / 2, 5);
  });

  it('will not walk into a machine', () => {
    // Aim him at the first machine on floor 1 from close range and push.
    const machine = FACTORY.floors[0].machines[0];
    const agent = createControlledAgent({
      index: 1,
      site: FACTORY,
      grids,
      start: { floorId: '1', position: { x: machine.position.x, z: machine.position.z + 2.4 } },
    });
    agent.setInput({ x: 0, z: -1 });
    for (let i = 0; i < 40; i++) agent.tick(100);

    const distance = Math.hypot(
      agent.state.position.x - machine.position.x,
      agent.state.position.z - machine.position.z,
    );
    // Still outside the footprint rather than standing in the middle of it.
    expect(distance).toBeGreaterThan(1.0);
  });

  it('slides along an obstacle rather than sticking on it', () => {
    const machine = FACTORY.floors[0].machines[0];
    const agent = createControlledAgent({
      index: 1,
      site: FACTORY,
      grids,
      start: { floorId: '1', position: { x: machine.position.x, z: machine.position.z + 2.4 } },
    });
    // Into the machine and to one side at the same time: the sideways
    // component has to survive even though the forward one is refused.
    agent.setInput({ x: 1, z: -1 });
    const startX = agent.state.position.x;
    for (let i = 0; i < 10; i++) agent.tick(100);
    expect(agent.state.position.x).toBeGreaterThan(startX + 0.5);
  });

  it('turns to face where it is pushed', () => {
    const agent = driver();
    agent.setInput({ x: 1, z: 0 });
    for (let i = 0; i < 20; i++) agent.tick(50);
    // atan2(1, 0) — the scene's convention has 0 looking down +z.
    expect(agent.state.facing).toBeCloseTo(Math.PI / 2, 1);
  });

  it('lands somewhere walkable when moved to another floor', () => {
    const agent = driver();
    agent.moveToFloor('4');
    expect(agent.state.floorId).toBe('4');

    const grid = grids.get('4');
    expect(grid).toBeDefined();
    // Prove it by walking: a worker dropped inside a wall cannot move at all.
    agent.setInput({ x: 1, z: 0 });
    agent.tick(200);
    expect(agent.state.movedThisTick).toBeGreaterThan(0);
  });

  it('walks a click-to-move route without stalling on waypoints', () => {
    // The first version shifted one waypoint per tick and then fell through
    // with no heading, so the trace read 0, step, 0, step — half speed, and a
    // visible limp. Every tick of a live route must cover ground.
    const agent = driver({ x: 0.45, z: -1.25 });
    expect(agent.walkTo({ x: 5, z: -12 })).toBe(true);

    let stalled = 0;
    for (let i = 0; i < 90; i++) {
      agent.tick(16.7);
      if (agent.state.movedThisTick === 0) stalled += 1;
    }
    expect(stalled).toBe(0);
  });

  it('cannot cross a machine even on a very long frame', () => {
    /*
      Collision is tested at the destination cell. A frame long enough to carry
      him further than one 0.5 m cell — the tick cap allows 0.525 m — would let
      him pass clean through a machine without ever landing inside it.
    */
    const machine = FACTORY.floors[0].machines[0];
    const agent = createControlledAgent({
      index: 1,
      site: FACTORY,
      grids,
      start: { floorId: '1', position: { x: machine.position.x, z: machine.position.z + 2.0 } },
    });
    agent.setInput({ x: 0, z: -1 });
    for (let i = 0; i < 30; i++) agent.tick(250);

    // He must have stopped on the near side, never emerging beyond it.
    expect(agent.state.position.z).toBeGreaterThan(machine.position.z);
  });

  it('lets the keyboard take over from a route', () => {
    // Two things steering one body is how a character walks backwards into a
    // wall, so any real input cancels the route outright.
    const agent = driver();
    agent.walkTo({ x: 5, z: -12 });
    expect(agent.destination()).not.toBeNull();
    agent.setInput({ x: -1, z: 0 });
    expect(agent.destination()).toBeNull();
  });

  it('ignores a floor the site does not have', () => {
    const agent = driver();
    agent.moveToFloor('99');
    expect(agent.state.floorId).toBe('1');
  });
});
