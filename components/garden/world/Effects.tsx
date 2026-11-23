"use client";

import { type JSX, useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import {
  BlendFunction,
  Effect,
  EffectAttribute,
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
 * Tiered post-processing: a soft bloom on high, a vignette on medium and
 * high, and nothing at all on low (no composer; the renderer tone-maps and
 * draws straight to the canvas). Tone mapping runs exactly once, first, then
 * bloom and the vignette.
 */
export function Effects({ tier }: { tier: TierSettings }) {
  if (!tier.bloom && !tier.vignette) return null;

  const effects: JSX.Element[] = [<SceneToneMapping key="tone" />];
  if (tier.bloom) {
    effects.push(
      <Bloom
        key="bloom"
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
    <EffectComposer enableNormalPass={false} multisampling={4}>
      {effects}
    </EffectComposer>
  );
}
