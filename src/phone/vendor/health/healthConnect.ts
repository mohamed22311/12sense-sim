/* STUB for a vendored dependency — not a copy.
 * `baseline.ts`/`restingBaseline.ts` read a trailing series from Health
 * Connect. The simulator's own vitals buffer is that series, so this module is
 * a seam: the fleet installs a reader at start-up and the vendored code calls
 * it without knowing the difference.
 *
 * Signature verified against the real module (Thalamus/src/health/
 * healthConnect.ts @ 15b11d4): `readBaselineSeries` takes no arguments — the
 * lookback window (RISK_CONFIG.baseline.days) is the real module's own
 * concern, not the caller's — and resolves null when Health Connect can't
 * serve the read (restingBaseline.ts:41-42 keeps the previous estimate then).
 */
import type { StepBucket, VitalReading } from './vitals';

export type BaselineSeries = { hr: VitalReading[]; steps: StepBucket[] };

export type BaselineSeriesReader = () => Promise<BaselineSeries | null>;

let reader: BaselineSeriesReader = async () => null;

/** Called once by the fleet; the vendored baseline code never sees this. */
export function installBaselineSeriesReader(next: BaselineSeriesReader): void {
  reader = next;
}

export function readBaselineSeries(): Promise<BaselineSeries | null> {
  return reader();
}
