import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, KernelSize, ToneMappingMode } from 'postprocessing';
import { useBuildingStore } from '@/state/buildingStore';

/**
 * The pass that makes light behave like light.
 *
 * Every emissive surface in this scene — a status lamp, a control screen, a
 * furnace door, an alarm ring — was drawing as a flat bright patch, because
 * without a bloom pass a pixel at 2.0 and a pixel at 0.9 both end up as the
 * same white after tone mapping. Nothing looked like it was *emitting*. Bloom
 * spills the values above the threshold into their surroundings, which is what
 * a bright source actually does to a lens and to an eye, and it is the single
 * strongest cue that separates a modern real-time render from a flat one.
 *
 * It is threshold-gated well above the brightest lit surface, so it catches
 * only things that are genuinely emitting. Set it lower and the whole building
 * hazes over — the failure mode where a scene looks like it was photographed
 * through grease, which reads as an effect rather than as light.
 *
 * The vignette is doing composition, not mood: the building sits centre-frame
 * with panels either side, and drawing the corners down keeps the eye in the
 * middle without a border.
 *
 * **Gated on the quality tier.** The composer costs a full-screen pass and the
 * sampler already knows what this machine can afford; on `low` the scene
 * renders straight to the buffer with no composer mounted at all.
 */
export function PostFx() {
  const tier = useBuildingStore((s) => s.qualityTier);
  /*
    `high` only, measured rather than assumed.

    The composer doubled frame time on the reference machine — 16.8 ms median
    to 34.9 ms — because it renders the scene into a half-float target and then
    runs bloom, tone mapping and a resolve over the whole screen. That is a
    fair price on a machine with headroom and an unfair one on a machine
    without, and the sampler already knows which this is.
  */
  if (tier !== 'high') return null;

  return (
    <EffectComposer
      /*
        The composer renders to its own target, which bypasses the renderer's
        antialiasing — without this every rail and every helmet re-acquires the
        stair-stepping the scene had before `antialias` was turned on. A
        multisampled target is the fix; two samples carries these edges at this
        object scale and four measured no better while costing more bandwidth
        on a half-float buffer.
      */
      multisampling={2}
    >
      <Bloom
        // Above every lit surface in the building and below every emissive one.
        luminanceThreshold={0.92}
        luminanceSmoothing={0.22}
        intensity={0.62}
        kernelSize={KernelSize.LARGE}
        // Mipmap blur builds the glow from a downsample chain instead of a
        // wide same-resolution kernel: the same spread for a fraction of the
        // fill rate, which is most of what makes this affordable at all.
        mipmapBlur
      />
      <Vignette offset={0.32} darkness={0.42} blendFunction={BlendFunction.NORMAL} />
      {/*
        Last in the chain, and not optional.

        The composer sets the renderer's tone mapping to `NoToneMapping` while
        it renders the scene into its HDR buffer and restores it afterwards —
        so the ACES pass configured on the canvas is bypassed entirely whenever
        this component is mounted. Without this effect the image comes out
        untone-mapped and blown out, and only on machines fast enough to earn
        the composer, which is the worst possible way to find a bug.

        It also has to run after bloom: bloom needs the real HDR values to
        decide what is emitting, and tone mapping is what compresses them for
        display.
      */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
