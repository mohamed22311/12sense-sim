import { useEffect } from 'react';
import { useStore } from '../state/store';

export function useScenario() {
  const phase    = useStore((s) => s.scenarioPhase);
  const setPhase = useStore((s) => s.setPhase);

  useEffect(() => {
    if (phase === 'machine_fail') {
      const t = setTimeout(() => setPhase('context_scan'), 1500);
      return () => clearTimeout(t);
    }
    if (phase === 'context_scan') {
      const t = setTimeout(() => setPhase('routing'), 2000);
      return () => clearTimeout(t);
    }
    if (phase === 'routing') {
      const t = setTimeout(() => setPhase('delivery'), 2500);
      return () => clearTimeout(t);
    }
    // delivery → alerting: driven by AlertOrb after all orbs arrive
    // alerting → acknowledged: triggered by the user via Acknowledge button
  }, [phase, setPhase]);
}
