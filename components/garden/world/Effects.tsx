"use client";

import { type JSX, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, FXAA, Vignette } from "@react-three/postprocessing";
import {
  BlendFunction,
  type BloomEffect,
  Effect,
  EffectAttribute,
  type EffectComposer as EffectComposerImpl,
  EffectPass,
} from "postprocessing";

import type { TierSettings } from "./tiers";

/**
 * Neutral tone mapping for everything except the sky.
 *
 * The Canvas tone-maps with `NeutralToneMapping` on the renderer. While a
 * composer is mounted it switches that off (the scene renders into a linear
 * half-float buffer), so the curve has to run once as a pass instead. The
 * stock `ToneMapping` effect would also map the sky dome, which draws with
 * `toneMapped: false` and no depth, and would dim it. This pass maps only
 * pixels with scene depth, so every colour comes out as the renderer alone
 * would draw it. `toneMappingExposure` is the renderer's own uniform.
 *
 * Any NaN or Inf is pinned to white, as an 8-bit canvas would show it, so
 * bloom's blur can never smear one into a blown-out patch.
 */
const SCENE_TONE_MAPPING = /* glsl */ `
#include <tonemapping_pars_fragment>

// NaN and Inf have an all-ones exponent. Checked on the bits, since fast-math
// shader compilers may fold isnan() to false.
float finiteChannel(float value) {
  return (floatBitsToUint(value) & 0x7f800000u) == 0x7f800000u ? 1.0 : value;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 color = vec3(
    finiteChannel(inputColor.r),
    finiteChannel(inputColor.g),
    finiteChannel(inputColor.b)
  );
  // The sky dome is never brighter than 1. A far-depth pixel above that is a
  // multisampled silhouette edge (the depth resolve keeps one sample), so it
  // is scene colour and gets mapped like the rest.
  bool sky = depth >= 1.0 && max(color.r, max(color.g, color.b)) <= 1.0;
  vec3 mapped = sky ? color : NeutralToneMapping(color);
  outputColor = vec4(max(mapped, 0.0), clamp(finiteChannel(inputColor.a), 0.0, 1.0));
}
`;

class SceneToneMappingEffect extends Effect {
  constructor() {
    super("SceneToneMappingEffect", SCENE_TONE_MAPPING, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
    });
  }
}

/**
 * Tone mapping as its own pass, ahead of bloom, so bloom's threshold and glow
 * work on display values: a sunlit cloud (linear 3 or so) blooms like any
 * other near-white highlight instead of flooding the frame.
 */
function SceneToneMapping() {
  const camera = useThree((state) => state.camera);
  const pass = useMemo(
    () => new EffectPass(camera, new SceneToneMappingEffect()),
    [camera],
  );
  useEffect(() => () => pass.dispose(), [pass]);
  return <primitive object={pass} />;
}

/**
 * Where the mounted composer is kept on the scene, so a screenshot can render
 * through it (the canvas itself has no multisampling while one is mounted).
 */
export const SCENE_COMPOSER_KEY = "gardenComposer";

/**
 * Tiered post-processing: a soft bloom on high, a vignette on medium and
 * high, and nothing at all on low (no composer; the renderer tone-maps and
 * draws straight to the canvas). Tone mapping runs exactly once, first, then
 * FXAA, bloom and the vignette.
 *
 * Anti-aliasing is FXAA, not multisampling. On the GPUs we measured, a
 * multisampled half-float target (plus its depth resolve) cost 5 ms at 2×
 * and 11 ms at 4× for a 1920×1200 canvas; FXAA rides along in the bloom and
 * vignette pass for well under a millisecond. The canvas context is created
 * without multisampling for the same reason (see `GardenScene`).
 */
export function Effects({ tier }: { tier: TierSettings }) {
  const getThree = useThree((state) => state.get);
  const composer = useRef<EffectComposerImpl>(null);
  const enabled = tier.bloom || tier.vignette;

  useLayoutEffect(() => {
    const current = composer.current;
    if (!enabled || !current) return;
    const { userData } = getThree().scene;
    userData[SCENE_COMPOSER_KEY] = current;
    return () => {
      if (userData[SCENE_COMPOSER_KEY] === current) {
        delete userData[SCENE_COMPOSER_KEY];
      }
    };
  }, [enabled, getThree]);

  // The mipmap blur downsamples the bright-pass right away, so it can start
  // from a half-resolution bright-pass with no visible change.
  const halfResolutionBloom = useCallback((effect: BloomEffect | null) => {
    if (effect) effect.luminancePass.resolution.scale = 0.5;
  }, []);

  if (!enabled) return null;

  // FXAA reads the tone-mapped buffer directly, so it leads its pass and
  // bloom and the vignette blend on top of the smoothed image.
  const effects: JSX.Element[] = [
    <SceneToneMapping key="tone" />,
    <FXAA key="fxaa" />,
  ];
  if (tier.bloom) {
    effects.push(
      <Bloom
        key="bloom"
        ref={halfResolutionBloom}
        intensity={0.25}
        luminanceThreshold={0.85}
        mipmapBlur
      />,
    );
  }
  if (tier.vignette) {
    effects.push(<Vignette key="vignette" offset={0.32} darkness={0.42} />);
  }

  return (
    <EffectComposer
      ref={composer}
      enableNormalPass={false}
      multisampling={0}
    >
      {effects}
    </EffectComposer>
  );
}
