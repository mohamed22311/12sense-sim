/**
 * Pick a quality tier from what this machine can actually do.
 *
 * The design asks for a tier chosen by measurement rather than by guessing at
 * the hardware, because the same laptop performs very differently on battery,
 * on an external display, or with thirty other tabs open. So the scene renders
 * at `high`, the first second or so of frames is sampled, and the tier steps
 * down if the frames are not arriving fast enough.
 *
 * Two properties matter more than the exact thresholds:
 *
 *  - **It only ever steps down, once.** A tier that oscillated would be worse
 *    than either setting: the scene would visibly pulse between fidelities
 *    while the framerate hovered around a threshold.
 *  - **The first frames are discarded.** Shader compilation, texture upload and
 *    React's first commit all land in the opening frames, and judging the
 *    machine on those would demote every device.
 */
export type QualityTier = 'high' | 'medium' | 'low';

/** Frames thrown away before measuring — compilation and first commit. */
const WARMUP_FRAMES = 30;

/** Frames measured before deciding. */
const SAMPLE_FRAMES = 60;

/** Median frame times above these fall to the tier below, ms. */
const MEDIUM_ABOVE_MS = 1000 / 50;
const LOW_ABOVE_MS = 1000 / 32;

export function tierForFrameTime(medianMs: number): QualityTier {
  if (medianMs > LOW_ABOVE_MS) return 'low';
  if (medianMs > MEDIUM_ABOVE_MS) return 'medium';
  return 'high';
}

export type QualitySampler = {
  /** Feed one frame's delta, in ms. Returns a tier once, when it decides. */
  sample(deltaMs: number): QualityTier | null;
  done: boolean;
};

export function createQualitySampler(): QualitySampler {
  const frames: number[] = [];
  let warmed = 0;
  const sampler: QualitySampler = {
    done: false,
    sample(deltaMs) {
      if (sampler.done) return null;
      if (warmed < WARMUP_FRAMES) {
        warmed += 1;
        return null;
      }
      frames.push(deltaMs);
      if (frames.length < SAMPLE_FRAMES) return null;

      sampler.done = true;
      // Median, not mean: one 200 ms hitch from a garbage collection should not
      // demote a machine that is otherwise comfortable.
      const sorted = [...frames].sort((a, b) => a - b);
      return tierForFrameTime(sorted[Math.floor(sorted.length / 2)]);
    },
  };
  return sampler;
}
