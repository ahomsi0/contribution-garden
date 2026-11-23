"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { PhotorealIslandSurfaceSampler } from "../photoreal-geometry";
import type {
  GardenDay,
  GardenQuality,
  GardenSeason,
  GardenSelection,
  GardenStats,
  GardenWeather,
} from "../types";
import { ISLAND_SURFACE_OFFSET } from "./Island";
import { intensityLevel, type GardenLayout } from "./mapping";
import {
  createFallbackMeadow,
  createMeadowLayout,
  type MeadowTuft,
} from "./meadow-layout";
import type { WorldPalette } from "./palette";
import type { TierSettings } from "./tiers";

export interface MeadowProps {
  days: GardenDay[];
  layout: GardenLayout;
  palette: WorldPalette;
  tier: TierSettings;
  /** Blade resolution: 2 segments on low, 3 otherwise. */
  quality: GardenQuality;
  season: GardenSeason;
  weather: GardenWeather;
  reducedMotion: boolean;
  seed: number;
  stats: GardenStats;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  visibleThrough?: string;
  onSelect?: (selection: GardenSelection | null) => void;
}

/** World-space tuft height per intensity level (index 0 unused). */
const LEVEL_HEIGHT = [0.12, 0.15, 0.22, 0.3, 0.39];
/** Local tuft width per intensity level (index 0 unused). */
const LEVEL_WIDTH = [0.36, 0.38, 0.44, 0.5, 0.57];
/** Share of autumn tufts whose tips turn golden. */
const AUTUMN_GOLD_SHARE = 0.24;
const BLADES_PER_TUFT = 3;

interface MeadowShades {
  /** Root colour per level 0..4 (linear). */
  root: THREE.Color[];
  /** Tip colour per level 0..4 (linear). */
  tip: THREE.Color[];
  /** Autumn golden tip, or null outside autumn. */
  golden: THREE.Color | null;
}

function meadowShades(palette: WorldPalette, season: GardenSeason): MeadowShades {
  const c = (hex: string) => new THREE.Color(hex);
  const levels = [0, 1, 2, 3, 4];

  if (season === "winter") {
    // Short frosted tufts: a muted evergreen root under a white frost tip.
    const deep = c(palette.evergreen[1]).lerp(c(palette.foliage[2]), 0.25);
    const frost = c(palette.snow ?? palette.grass[1]);
    const sage = c(palette.foliage[2]);
    return {
      root: levels.map((l) =>
        deep.clone().lerp(sage, 0.3).multiplyScalar(0.72 + l * 0.05),
      ),
      tip: levels.map((l) => sage.clone().lerp(frost, 0.72 + l * 0.06)),
      golden: null,
    };
  }

  const [g0, g1] = palette.grass.map(c);
  // Autumn foliage is orange; its grass stays green, so ramp through the
  // evergreens instead and keep the foliage gold for a few tips.
  const greens =
    season === "autumn"
      ? [c(palette.evergreen[1]), c(palette.evergreen[0]), g0.clone(), g1.clone()]
      : palette.foliage.map(c);
  const dry = c(palette.grassDry);
  const deep = greens[0].clone().lerp(g0, 0.15);

  // Light users get short, slightly dry tufts; heavy users deep, saturated,
  // sunlit greens.
  const tip = [
    g0.clone().lerp(dry, 0.35),
    g0.clone().lerp(dry, 0.35),
    g0.clone().lerp(greens[1], 0.5),
    greens[1].clone().lerp(greens[2], 0.6).offsetHSL(0, 0.05, 0),
    greens[2].clone().lerp(greens[3], 0.45).offsetHSL(0, 0.08, 0).multiplyScalar(1.1),
  ];
  return {
    root: levels.map((l) => deep.clone().multiplyScalar(0.34 + l * 0.05)),
    tip,
    golden:
      season === "autumn"
        ? c(palette.grassDry).lerp(c(palette.foliage[3]), 0.55)
        : null,
  };
}

function tuftTip(tuft: MeadowTuft, shades: MeadowShades) {
  if (shades.golden && tuft.tint < AUTUMN_GOLD_SHARE) return shades.golden;
  return shades.tip[tuft.level] ?? shades.tip[2];
}

/**
 * One tuft: three tapered blades fanned around the root, each leaning
 * outward. Normals lean up so the tuft lights like the ground it grows from.
 */
function createTuftGeometry(segments: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const bladeT: number[] = [];
  const indices: number[] = [];

  for (let blade = 0; blade < BLADES_PER_TUFT; blade += 1) {
    const yaw = (blade / BLADES_PER_TUFT) * Math.PI * 2 + blade * 0.35;
    const dirX = Math.cos(yaw);
    const dirZ = Math.sin(yaw);
    const sideX = -dirZ;
    const sideZ = dirX;
    const height = 1 - blade * 0.14;
    const lean = 0.16 + blade * 0.07;
    const normal = new THREE.Vector3(dirX * 0.35, 1, dirZ * 0.35).normalize();
    const start = positions.length / 3;

    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const width = 0.1 * Math.pow(1 - t, 1.15) + 0.004;
      const bend = lean * Math.pow(t, 1.6);
      const cx = dirX * bend;
      const cz = dirZ * bend;
      const y = t * height;
      positions.push(cx + sideX * width, y, cz + sideZ * width);
      positions.push(cx - sideX * width, y, cz - sideZ * width);
      // Soft occlusion at the root on top of the root-to-tip gradient.
      const shade = 0.78 + 0.22 * Math.min(1, t * 1.6);
      for (let k = 0; k < 2; k += 1) {
        normals.push(normal.x, normal.y, normal.z);
        colors.push(shade, shade, shade);
        bladeT.push(t);
      }
    }

    for (let index = 0; index < segments; index += 1) {
      const a = start + index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aBladeT", new THREE.Float32BufferAttribute(bladeT, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

interface MeadowUniforms {
  uTime: { value: number };
  uSway: { value: number };
}

/**
 * Lit, vertex-coloured grass. `instanceColor` carries the root colour and the
 * per-instance `aTip` attribute the tip colour; the shader blends them along
 * the blade and sways the upper blade with time.
 */
function createMeadowMaterial() {
  const uniforms: MeadowUniforms = {
    uTime: { value: 0 },
    uSway: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSway = uniforms.uSway;
    shader.vertexShader = `attribute float aBladeT;
attribute vec3 aTip;
uniform float uTime;
uniform float uSway;
${shader.vertexShader}`
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 swayBase = instanceMatrix[3].xz;
#else
  vec2 swayBase = vec2(0.0);
#endif
  float swayAmount = aBladeT * aBladeT * uSway;
  transformed.x += sin(uTime * 1.7 + swayBase.x * 1.3 + swayBase.y * 0.9) * swayAmount;
  transformed.z += cos(uTime * 1.3 + swayBase.x * 0.7 - swayBase.y * 1.1) * swayAmount * 0.7;`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = mix(instanceColor.rgb, aTip, pow(aBladeT, 1.3));
  #ifdef USE_COLOR
    vColor.rgb *= color.rgb;
  #endif
#endif`,
      );
    // Blades are thin cards: light both faces with the same up-leaning
    // normal instead of flipping it on the back face.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      THREE.ShaderChunk.normal_fragment_begin.replace(
        "float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;",
        "float faceDirection = 1.0;",
      ),
    );
  };
  material.customProgramCacheKey = () => "garden-meadow-v1";
  material.userData.uniforms = uniforms;
  return material;
}

function meadowUniforms(mesh: THREE.InstancedMesh | null) {
  if (!mesh) return null;
  const material = mesh.material as THREE.Material;
  return (material.userData.uniforms as MeadowUniforms | undefined) ?? null;
}

function formatGardenDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function Meadow({
  days,
  layout,
  palette,
  tier,
  quality,
  season,
  weather,
  reducedMotion,
  seed,
  stats,
  surfaceSampler,
  visibleThrough,
  onSelect,
}: MeadowProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const density = tier.density;
  const { x: pondX, z: pondZ, scale: pondScale } = layout.pond;

  const tufts = useMemo<MeadowTuft[]>(() => {
    const pond = { x: pondX, z: pondZ, scale: pondScale };
    if (days.length > 0) {
      return createMeadowLayout({ days, density, seed, visibleThrough, pond });
    }
    return createFallbackMeadow(stats.commits, density, seed, pond);
  }, [days, density, pondScale, pondX, pondZ, seed, stats.commits, visibleThrough]);

  const shades = useMemo(() => meadowShades(palette, season), [palette, season]);

  const segments = quality === "low" ? 2 : 3;
  const geometry = useMemo(() => {
    const tuftGeometry = createTuftGeometry(segments);
    const tips = new Float32Array(Math.max(1, tufts.length) * 3);
    tufts.forEach((tuft, index) => {
      const tip = tuftTip(tuft, shades);
      tips[index * 3] = tip.r;
      tips[index * 3 + 1] = tip.g;
      tips[index * 3 + 2] = tip.b;
    });
    tuftGeometry.setAttribute("aTip", new THREE.InstancedBufferAttribute(tips, 3));
    return tuftGeometry;
  }, [segments, shades, tufts]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => createMeadowMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  const wind = weather === "wind" ? 1 : weather === "rain" ? 0.62 : 0.36;
  const sway = reducedMotion ? 0 : 0.17 * wind;

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const dummy = new THREE.Object3D();
    const winter = season === "winter";
    tufts.forEach((tuft, index) => {
      const level = Math.min(4, Math.max(1, tuft.level));
      const jitter = Math.min(
        1.3,
        Math.max(0.75, tuft.scale / (0.61 + level * 0.12)),
      );
      const fuller = Math.min(3, tuft.girth);
      const height =
        LEVEL_HEIGHT[level] * jitter * (1 + (fuller - 1) * 0.12) * (winter ? 0.45 : 1);
      const width =
        LEVEL_WIDTH[level] * (0.9 + jitter * 0.1) * Math.sqrt(fuller) * (winter ? 0.85 : 1);
      const surfaceY =
        (surfaceSampler(tuft.x, tuft.z) ?? 0) + ISLAND_SURFACE_OFFSET;
      dummy.position.set(tuft.x, surfaceY - 0.008, tuft.z);
      dummy.rotation.set(
        (tuft.variant - 1.5) * 0.04,
        tuft.rotation,
        (tuft.variant % 2 ? 1 : -1) * 0.05,
      );
      dummy.scale.set(width, height, width);
      dummy.updateMatrix();
      instanced.setMatrixAt(index, dummy.matrix);
      instanced.setColorAt(index, shades.root[level]);
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    // Refresh the culling and raycast bounds for the new instance spread.
    instanced.computeBoundingSphere();
  }, [season, shades, surfaceSampler, tufts]);

  useFrame((state) => {
    const uniforms = meadowUniforms(mesh.current);
    if (!uniforms) return;
    uniforms.uSway.value = sway;
    if (!reducedMotion) uniforms.uTime.value = state.clock.elapsedTime;
  });

  const cursorHandlers = useMemo(
    () => ({
      onPointerOver: (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const target = event.nativeEvent.target;
        if (target instanceof HTMLElement) target.style.cursor = "pointer";
      },
      onPointerOut: (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const target = event.nativeEvent.target;
        if (target instanceof HTMLElement) target.style.cursor = "grab";
      },
    }),
    [],
  );

  const selectTuft = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const instanceId = event.instanceId ?? 0;
    const item = tufts[instanceId] ?? tufts[0];
    if (!item) return;
    const day = item.dayIndex >= 0 ? days[item.dayIndex] : undefined;
    const contributionCount = day?.count ?? stats.commits;
    const title = day ? formatGardenDate(day.date) : "Commit meadow";
    const repositoryText = day
      ? day.repositories?.length
        ? day.repositories.join(", ")
        : undefined
      : `${stats.repositories} repositories feed this habitat`;
    const groundY =
      (surfaceSampler(item.x, item.z) ?? 0) + ISLAND_SURFACE_OFFSET;

    onSelect?.({
      kind: "contribution",
      id: day ? `day-${day.date}` : `meadow-${instanceId}`,
      title,
      subtitle: day ? "Daily activity plot" : "Commit meadow",
      description: day
        ? contributionCount > 0
          ? `${contributionCount} contribution${contributionCount === 1 ? "" : "s"} grew this plot in the ${day.date.slice(0, 4)} annual bed.`
          : "A quiet plot preserves the gap between active days."
        : "Every commit adds another living detail to this meadow.",
      accent: `#${tuftTip(item, shades).getHexString()}`,
      worldPosition: [item.x, groundY + 0.3, item.z],
      date: day?.date,
      count: contributionCount,
      repositories: day?.repositories,
      details: [
        ...(day ? [{ label: "Date", value: day.date }] : []),
        { label: day ? "Contributions" : "Commits", value: contributionCount },
        ...(day
          ? [{ label: "Intensity", value: `${intensityLevel(day.count)}/4` }]
          : []),
        ...(repositoryText
          ? [{ label: "Repositories", value: repositoryText }]
          : []),
      ],
    });
  };

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, tufts.length]}
      // Grass only receives shadows; its own would be too fine to read.
      receiveShadow={tier.shadows}
      onClick={selectTuft}
      {...cursorHandlers}
    />
  );
}
