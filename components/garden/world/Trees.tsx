"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { PhotorealIslandSurfaceSampler } from "../photoreal-geometry";
import type {
  GardenQuality,
  GardenSeason,
  GardenSelection,
  GardenStats,
  GardenWeather,
} from "../types";
import { ISLAND_SURFACE_OFFSET } from "./Island";
import type { GardenLayout } from "./mapping";
import type { WorldPalette } from "./palette";
import type { TierSettings } from "./tiers";
import {
  buildTree,
  mulberry32,
  TAU,
  type CanopyBlob,
  type GreatLimb,
  type PineTier,
  type TreeKind,
  type TreeShape,
  type WoodSegment,
} from "./tree-shapes";

export interface TreesProps {
  layout: GardenLayout;
  palette: WorldPalette;
  tier: TierSettings;
  /** Canopy resolution, and wind (off on low). */
  quality: GardenQuality;
  season: GardenSeason;
  weather: GardenWeather;
  reducedMotion: boolean;
  seed: number;
  stats: GardenStats;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  onSelect?: (selection: GardenSelection | null) => void;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const smoothstep = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Bottom of a canopy is 0.72x the base colour, the top 1.12x. */
const SHADE_BOTTOM = 0.72;
const SHADE_TOP = 1.12;

/**
 * A smooth, slightly lumpy blob with a flatter underside. The vertical
 * gradient is baked into the vertex colours (multiplied by the instance
 * colour), and `aSnowMask` marks the top quarter for winter dusting.
 */
function createBlobGeometry(detail: number) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const geometry = mergeVertices(ico);
  ico.dispose();
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const lump =
      1 +
      0.045 * Math.sin(x * 3.1 + 0.7) * Math.sin(y * 2.7 + 1.9) +
      0.04 * Math.sin(z * 3.3 + 0.4) * Math.cos(x * 2.2 - 0.6) +
      0.025 * Math.sin((x + z) * 6.1 + y * 4.3);
    const flatY = y < 0 ? y * 0.78 : y;
    position.setXYZ(i, x * lump, flatY * lump, z * lump);
    minY = Math.min(minY, flatY * lump);
    maxY = Math.max(maxY, flatY * lump);
  }
  const colors = new Float32Array(position.count * 3);
  const snow = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) - minY) / (maxY - minY);
    const shade = SHADE_BOTTOM + (SHADE_TOP - SHADE_BOTTOM) * Math.pow(t, 0.85);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
    snow[i] = smoothstep(0.7, 0.86, t);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSnowMask", new THREE.BufferAttribute(snow, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** A unit cone with its base at y = 0 and a softly scalloped hem. */
function createConeGeometry() {
  const geometry = new THREE.ConeGeometry(1, 1, 12, 4);
  geometry.translate(0, 0.5, 0);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const snow = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (y < 0.001 && Math.hypot(x, z) > 0.5) {
      const angle = Math.atan2(z, x);
      position.setY(i, -0.06 * (1 + Math.sin(angle * 6)));
    }
    const shade = SHADE_BOTTOM + (SHADE_TOP - SHADE_BOTTOM) * Math.max(0, y);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
    snow[i] = smoothstep(0.55, 0.8, y);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSnowMask", new THREE.BufferAttribute(snow, 1));
  return geometry;
}

/** A unit trunk (radius 1 at the base, height 1) with a slight taper and flare. */
function createTrunkGeometry() {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 10, 6, true);
  geometry.translate(0, 0.5, 0);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const t = position.getY(i);
    const radial = (1 - 0.38 * t) * (1 + 0.5 * Math.exp(-t * 10));
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setXYZ(i, x * radial, t, z * radial);
    const angle = Math.atan2(z, x);
    const shade = 0.8 + 0.2 * t + 0.06 * Math.sin(angle * 6 + t * 3);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A unit branch: radius 1 at the base tapering to 0.45, height 1. */
function createBranchGeometry() {
  const geometry = new THREE.CylinderGeometry(0.45, 1, 1, 6, 1, true);
  geometry.translate(0, 0.5, 0);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(count * 3).fill(0.92), 3),
  );
  return geometry;
}

interface WoodColours {
  bark: THREE.Color;
  moss: THREE.Color | null;
  snow: THREE.Color | null;
}

/** One gnarled tube along a smooth curve, with bark ridges baked into colour. */
function createLimbGeometry(
  limb: GreatLimb,
  rootAngles: number[],
  colours: WoodColours,
  seed: number,
) {
  const points = limb.path.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const steps = limb.flare ? 16 : limb.radius[0] > 0.2 ? 12 : 7;
  const radial = limb.flare ? 16 : limb.radius[0] > 0.2 ? 10 : 6;
  const frames = curve.computeFrenetFrames(steps, false);
  const positions: number[] = [];
  const ridges: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const s = seed * 0.37;

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    curve.getPointAt(t, point);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const base = limb.radius[0] + (limb.radius[1] - limb.radius[0]) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * TAU;
      dir
        .copy(normal)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(binormal, Math.sin(theta));
      const ridge =
        0.55 * Math.sin(theta * 5 + t * 6 + s) + 0.45 * Math.sin(theta * 3 - t * 9 + s * 2);
      let radius = base * (1 + limb.gnarl * ridge);
      if (limb.flare) {
        // Flare the base and swell it into buttresses toward each root.
        const heading = Math.atan2(dir.z, dir.x);
        let lobe = 0;
        for (const a of rootAngles) {
          lobe += Math.pow(Math.max(0, Math.cos(heading - a)), 8);
        }
        radius *= 1 + Math.exp(-t * 6) * (0.35 + 0.75 * lobe);
      }
      positions.push(
        point.x + dir.x * radius,
        point.y + dir.y * radius,
        point.z + dir.z * radius,
      );
      ridges.push(ridge);
    }
  }
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(ridges.length * 3);
  const colour = new THREE.Color();
  for (let i = 0; i < ridges.length; i += 1) {
    const y = positions[i * 3 + 1];
    const up = normals.getY(i);
    // Grooves are darker; wood near the ground is darker still.
    const shade = (0.84 + 0.16 * ridges[i]) * (0.78 + 0.22 * Math.min(1, Math.max(0, y) / 1.6));
    colour.copy(colours.bark).multiplyScalar(shade);
    if (colours.snow) {
      colour.lerp(colours.snow, smoothstep(0.5, 0.85, up) * 0.75);
    } else if (colours.moss && y < 1.4) {
      colour.lerp(colours.moss, smoothstep(0.3, 0.9, up) * 0.4 * (1 - y / 1.4));
    }
    colors[i * 3] = colour.r;
    colors[i * 3 + 1] = colour.g;
    colors[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** The great tree's trunk, roots and limbs, merged into one mesh. */
function createGreatWoodGeometry(shape: TreeShape, colours: WoodColours) {
  const parts = shape.limbs.map((limb, index) =>
    createLimbGeometry(limb, shape.rootAngles, colours, index + 1),
  );
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.BufferGeometry();
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

interface FoliageUniforms {
  uTime: { value: number };
  uSway: { value: number };
  uSnow: { value: number };
  uSnowColor: { value: THREE.Color };
  uGlow: { value: number };
  uGlowColor: { value: THREE.Color };
}

/**
 * Lit canopy material. Per instance: `aSway` (sway amplitude in world units),
 * `aPhase` (the tree's wind phase, shared by its blobs so they move together)
 * and `aGlow` (great-tree emissive mask). Wind is a world-space offset in the
 * vertex shader, so geometry and instance matrices never change per frame.
 */
function createFoliageMaterial() {
  const uniforms: FoliageUniforms = {
    uTime: { value: 0 },
    uSway: { value: 0 },
    uSnow: { value: 0 },
    uSnowColor: { value: new THREE.Color("#ffffff") },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color("#000000") },
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aSnowMask;
attribute float aSway;
attribute float aPhase;
attribute float aGlow;
uniform float uTime;
uniform float uSway;
uniform float uSnow;
uniform vec3 uSnowColor;
varying float vGlow;
${shader.vertexShader}`
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor.rgb = mix(vColor.rgb, uSnowColor, aSnowMask * uSnow);
#endif
  vGlow = aGlow;`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
  float swayAmp = aSway * uSway * (0.8 + 0.2 * position.y);
  mvPosition.x += (sin(uTime * 1.25 + aPhase) + 0.3 * sin(uTime * 2.7 + aPhase * 1.7)) * swayAmp;
  mvPosition.z += cos(uTime * 1.05 + aPhase * 1.3) * swayAmp * 0.7;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = `uniform float uGlow;
uniform vec3 uGlowColor;
varying float vGlow;
${shader.fragmentShader}`.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
  totalEmissiveRadiance += uGlowColor * (uGlow * vGlow);`,
    );
  };
  material.customProgramCacheKey = () => "garden-foliage-v1";
  material.userData.uniforms = uniforms;
  return material;
}

function foliageUniforms(mesh: THREE.InstancedMesh | null) {
  if (!mesh) return null;
  const material = mesh.material as THREE.Material;
  return (material.userData.uniforms as FoliageUniforms | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Forest assembly
// ---------------------------------------------------------------------------

/** Who an instance belongs to: a year-tree index, or GREAT for the great tree. */
const GREAT = -1;

interface InstanceBatch {
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  owners: number[];
  sway: number[];
  phase: number[];
  glow: number[];
}

const emptyBatch = (): InstanceBatch => ({
  matrices: [],
  colors: [],
  owners: [],
  sway: [],
  phase: [],
  glow: [],
});

interface YearTreeInfo {
  rootY: number;
  height: number;
  accent: string;
}

interface Forest {
  canopy: InstanceBatch;
  cones: InstanceBatch;
  trunks: InstanceBatch;
  branches: InstanceBatch;
  years: YearTreeInfo[];
  great: { scale: number; shape: TreeShape; rootY: number; rotation: number; accent: string };
}

const UP = new THREE.Vector3(0, 1, 0);

function segmentMatrix(segment: WoodSegment, root: THREE.Matrix4) {
  const from = new THREE.Vector3(...segment.from);
  const direction = new THREE.Vector3(...segment.to).sub(from);
  const length = Math.max(0.001, direction.length());
  const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction.divideScalar(length));
  const local = new THREE.Matrix4().compose(
    from,
    rotation,
    new THREE.Vector3(segment.radius, length, segment.radius),
  );
  return root.clone().multiply(local);
}

function blobMatrix(blob: CanopyBlob, root: THREE.Matrix4) {
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...blob.position),
    new THREE.Quaternion().setFromAxisAngle(UP, blob.yaw),
    new THREE.Vector3(blob.radius, blob.radius * blob.squash, blob.radius),
  );
  return root.clone().multiply(local);
}

function coneMatrix(tier: PineTier, root: THREE.Matrix4) {
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(0, tier.y, 0),
    new THREE.Quaternion().setFromAxisAngle(UP, tier.yaw),
    new THREE.Vector3(tier.radius, tier.height, tier.radius),
  );
  return root.clone().multiply(local);
}

function rootMatrix(x: number, y: number, z: number, rotation: number, scale: number) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, rotation),
    new THREE.Vector3(scale, scale, scale),
  );
}

function groundAt(sampler: PhotorealIslandSurfaceSampler, x: number, z: number) {
  // Sink the base a touch so flared roots meet the turf.
  return (sampler(x, z) ?? 0) + ISLAND_SURFACE_OFFSET - 0.04;
}

/** Canopy colour for one blob: the tree's base, sunlit toward the crown. */
function blobColour(
  base: THREE.Color,
  highlight: THREE.Color,
  blob: CanopyBlob,
  blossom: THREE.Color | null,
  rand: () => number,
) {
  // Blossom replaces the green rather than mixing with it: green halfway to
  // pink reads as brown.
  const colour =
    blossom && rand() < 0.3
      ? blossom.clone().lerp(highlight, 0.12)
      : base.clone().lerp(highlight, 0.28 * blob.height);
  colour.offsetHSL(0, 0, blob.shade * 0.025);
  return colour;
}

/** Tree scales are rounded to this step, so timeline playback rebuilds the
 * forest only when a tree has grown visibly, not on every frame of data. */
const SCALE_STEP = 0.02;
const bucketScale = (scale: number) => Math.round(scale / SCALE_STEP) * SCALE_STEP;

interface PlacedTree {
  year: number;
  evergreen: boolean;
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

interface PlacedGreatTree {
  x: number;
  z: number;
  scale: number;
  glowing: boolean;
}

/**
 * A string that changes only when a visible tree appears, moves or grows by
 * a scale step: the forest is keyed on it rather than on the layout object,
 * which is new on every timeline step.
 */
function forestKey(layout: GardenLayout) {
  const trees = layout.yearTrees
    .map((tree) =>
      [
        tree.year,
        tree.evergreen ? 1 : 0,
        tree.x.toFixed(3),
        tree.z.toFixed(3),
        tree.rotation.toFixed(4),
        bucketScale(tree.scale).toFixed(2),
      ].join(","),
    )
    .join("|");
  const great = layout.greatTree;
  return `${trees}#${great.x},${great.z},${bucketScale(great.scale).toFixed(2)},${great.glowing ? 1 : 0}`;
}

function parseForestKey(key: string): { trees: PlacedTree[]; great: PlacedGreatTree } {
  const [treePart, greatPart] = key.split("#");
  const trees = treePart
    ? treePart.split("|").map((entry) => {
        const [year, evergreen, x, z, rotation, scale] = entry.split(",").map(Number);
        return { year, evergreen: evergreen === 1, x, z, rotation, scale };
      })
    : [];
  const [x, z, scale, glowing] = greatPart.split(",").map(Number);
  return { trees, great: { x, z, scale, glowing: glowing === 1 } };
}

function buildForest(
  trees: ReadonlyArray<PlacedTree>,
  great: PlacedGreatTree,
  greatShape: TreeShape,
  palette: WorldPalette,
  sampler: PhotorealIslandSurfaceSampler,
  season: GardenSeason,
  seed: number,
): Forest {
  const canopy = emptyBatch();
  const cones = emptyBatch();
  const trunks = emptyBatch();
  const branches = emptyBatch();
  const years: YearTreeInfo[] = [];
  const bare = palette.bareDeciduous;
  const foliage = palette.foliage.map((hex) => new THREE.Color(hex));
  const evergreen = palette.evergreen.map((hex) => new THREE.Color(hex));
  const trunk = new THREE.Color(palette.trunk);
  const blossom = palette.blossom ? new THREE.Color(palette.blossom) : null;
  // Autumn spreads across every warm shade; otherwise the lightest green is
  // kept for sunlit crowns.
  const baseChoices = season === "autumn" ? 4 : 3;

  const addWood = (segment: WoodSegment, root: THREE.Matrix4, owner: number, target: InstanceBatch, colour: THREE.Color) => {
    target.matrices.push(segmentMatrix(segment, root));
    target.colors.push(colour);
    target.owners.push(owner);
    target.sway.push(0);
    target.phase.push(0);
    target.glow.push(0);
  };

  trees.forEach((tree, index) => {
    const treeSeed = (seed ^ Math.imul(tree.year, 2654435761)) >>> 0;
    const rand = mulberry32(treeSeed + 17);
    const kind: TreeKind = tree.evergreen ? "evergreen" : "deciduous";
    const shape = buildTree(kind, treeSeed, { bare });
    const rootY = groundAt(sampler, tree.x, tree.z);
    const root = rootMatrix(tree.x, rootY, tree.z, tree.rotation, tree.scale);
    const phase = tree.x * 0.7 + tree.z * 0.4;
    const barkColour = trunk.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.05);

    if (shape.trunk) addWood(shape.trunk, root, index, trunks, barkColour);
    for (const branch of shape.branches) addWood(branch, root, index, branches, barkColour);

    let accent: THREE.Color;
    if (kind === "evergreen") {
      const base = evergreen[Math.floor(rand() * evergreen.length)]
        .clone()
        .offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.06);
      accent = base;
      shape.cones.forEach((tier, k) => {
        cones.matrices.push(coneMatrix(tier, root));
        cones.colors.push(base.clone().offsetHSL(0, 0, k * 0.012));
        cones.owners.push(index);
        cones.sway.push(0.025 * tree.scale * (0.6 + k * 0.2));
        cones.phase.push(phase);
        cones.glow.push(0);
      });
    } else {
      const choice = Math.floor(rand() * baseChoices);
      const base = foliage[choice]
        .clone()
        .offsetHSL((rand() - 0.5) * 0.08, 0, (rand() - 0.5) * 0.08);
      const highlight = foliage[Math.min(3, choice + 1)];
      accent = base;
      for (const blob of shape.blobs) {
        canopy.matrices.push(blobMatrix(blob, root));
        canopy.colors.push(
          blob.tuft ? foliage[2].clone() : blobColour(base, highlight, blob, blossom, rand),
        );
        canopy.owners.push(index);
        canopy.sway.push(0.05 * tree.scale * (0.6 + 0.4 * blob.height));
        canopy.phase.push(phase);
        canopy.glow.push(0);
      }
    }
    years.push({ rootY, height: shape.height, accent: `#${accent.getHexString()}` });
  });

  const greatRand = mulberry32(seed + 4049);
  const greatRootY = groundAt(sampler, great.x, great.z) - 0.04;
  const greatRotation = -0.24 + (greatRand() - 0.5) * 0.6;
  const greatRoot = rootMatrix(great.x, greatRootY, great.z, greatRotation, great.scale);
  const greatBase = foliage[1].clone().offsetHSL((greatRand() - 0.5) * 0.04, 0.03, 0);
  const greatHighlight = foliage[3].clone().lerp(foliage[2], 0.3);
  for (const blob of greatShape.blobs) {
    canopy.matrices.push(blobMatrix(blob, greatRoot));
    canopy.colors.push(
      blob.tuft
        ? foliage[2].clone()
        : blobColour(greatBase, greatHighlight, blob, blossom, greatRand),
    );
    canopy.owners.push(GREAT);
    canopy.sway.push(0.03 * great.scale * (0.6 + 0.4 * blob.height));
    canopy.phase.push(great.x * 0.7 + great.z * 0.4);
    canopy.glow.push(great.glowing ? 1 : 0);
  }
  for (const branch of greatShape.branches) addWood(branch, greatRoot, GREAT, branches, trunk);

  return {
    canopy,
    cones,
    trunks,
    branches,
    years,
    great: {
      scale: great.scale,
      shape: greatShape,
      rootY: greatRootY,
      rotation: greatRotation,
      accent: great.glowing ? palette.waterGlow : `#${greatBase.getHexString()}`,
    },
  };
}

/** Clone the base geometry and attach this batch's per-instance attributes. */
function withInstanceAttributes(base: THREE.BufferGeometry, batch: InstanceBatch) {
  const geometry = base.clone();
  const count = Math.max(1, batch.owners.length);
  const attribute = (values: number[]) => {
    const array = new Float32Array(count);
    array.set(values);
    return new THREE.InstancedBufferAttribute(array, 1);
  };
  geometry.setAttribute("aSway", attribute(batch.sway));
  geometry.setAttribute("aPhase", attribute(batch.phase));
  geometry.setAttribute("aGlow", attribute(batch.glow));
  return geometry;
}

function applyBatch(mesh: THREE.InstancedMesh | null, batch: InstanceBatch) {
  if (!mesh) return;
  batch.matrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, batch.colors[index]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MOTE_COUNT = 7;

/** A small ring of glow motes in the great tree's crown. */
function placeMotes(motes: THREE.InstancedMesh, colour: string) {
  const dummy = new THREE.Object3D();
  for (let index = 0; index < MOTE_COUNT; index += 1) {
    const angle = (index / MOTE_COUNT) * TAU;
    const radius = 2.0 + (index % 2) * 0.6;
    dummy.position.set(
      Math.cos(angle) * radius,
      3.1 + (index % 3) * 0.35,
      Math.sin(angle) * radius,
    );
    dummy.scale.setScalar(0.06 + (index % 2) * 0.025);
    dummy.updateMatrix();
    motes.setMatrixAt(index, dummy.matrix);
  }
  motes.instanceMatrix.needsUpdate = true;
  motes.computeBoundingSphere();
  (motes.material as THREE.MeshBasicMaterial).color.set(colour);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * One tree per contribution year around the ring, plus the great tree for the
 * lifetime total. Every canopy blob, trunk, branch and pine cone is instanced:
 * six draw calls for the whole forest (seven with glow motes).
 */
export function Trees({
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
  onSelect,
}: TreesProps) {
  // Meshes are state, not refs, so the effects that write their instances
  // run again whenever R3F replaces one (its args changed).
  const [canopyMesh, setCanopyMesh] = useState<THREE.InstancedMesh | null>(null);
  const [coneMesh, setConeMesh] = useState<THREE.InstancedMesh | null>(null);
  const [trunkMesh, setTrunkMesh] = useState<THREE.InstancedMesh | null>(null);
  const [branchMesh, setBranchMesh] = useState<THREE.InstancedMesh | null>(null);
  const [moteMesh, setMoteMesh] = useState<THREE.InstancedMesh | null>(null);
  const moteRef = useRef<THREE.Group>(null);
  const foliageMeshes = useMemo(() => [canopyMesh, coneMesh], [canopyMesh, coneMesh]);
  const swayLevel = useRef(0);

  // The great tree's shape depends only on its seed and whether the season
  // leaves it bare; its size is the mesh scale, so its wood geometry never
  // rebuilds as the timeline grows it.
  const bare = palette.bareDeciduous;
  const greatShape = useMemo(() => buildTree("great", seed + 4051, { bare }), [bare, seed]);
  const placementKey = forestKey(layout);
  const forest = useMemo(() => {
    const { trees, great } = parseForestKey(placementKey);
    return buildForest(trees, great, greatShape, palette, surfaceSampler, season, seed);
  }, [greatShape, palette, placementKey, season, seed, surfaceSampler]);

  const blobDetail = quality === "low" ? 1 : 2;
  const blobBase = useMemo(() => createBlobGeometry(blobDetail), [blobDetail]);
  const coneBase = useMemo(() => createConeGeometry(), []);
  const trunkGeometry = useMemo(() => createTrunkGeometry(), []);
  const branchGeometry = useMemo(() => createBranchGeometry(), []);
  const canopyGeometry = useMemo(
    () => withInstanceAttributes(blobBase, forest.canopy),
    [blobBase, forest.canopy],
  );
  const coneGeometry = useMemo(
    () => withInstanceAttributes(coneBase, forest.cones),
    [coneBase, forest.cones],
  );
  const greatWood = useMemo(
    () =>
      createGreatWoodGeometry(greatShape, {
        bark: new THREE.Color(palette.trunk),
        moss: palette.snow ? null : new THREE.Color(palette.evergreen[1]).multiplyScalar(0.8),
        snow: palette.snow ? new THREE.Color(palette.snow) : null,
      }),
    [greatShape, palette.evergreen, palette.snow, palette.trunk],
  );
  const canopyMaterial = useMemo(() => createFoliageMaterial(), []);
  const coneMaterial = useMemo(() => createFoliageMaterial(), []);
  const woodMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
    [],
  );
  const moteGeometry = useMemo(() => new THREE.SphereGeometry(1, 8, 6), []);
  const moteMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false }),
    [],
  );

  useEffect(() => () => blobBase.dispose(), [blobBase]);
  useEffect(() => () => coneBase.dispose(), [coneBase]);
  useEffect(() => () => canopyGeometry.dispose(), [canopyGeometry]);
  useEffect(() => () => coneGeometry.dispose(), [coneGeometry]);
  useEffect(() => () => greatWood.dispose(), [greatWood]);
  useEffect(
    () => () => {
      trunkGeometry.dispose();
      branchGeometry.dispose();
      moteGeometry.dispose();
      moteMaterial.dispose();
      canopyMaterial.dispose();
      coneMaterial.dispose();
      woodMaterial.dispose();
    },
    [
      branchGeometry,
      canopyMaterial,
      coneMaterial,
      moteGeometry,
      moteMaterial,
      trunkGeometry,
      woodMaterial,
    ],
  );

  useLayoutEffect(() => {
    applyBatch(canopyMesh, forest.canopy);
    applyBatch(coneMesh, forest.cones);
    applyBatch(trunkMesh, forest.trunks);
    applyBatch(branchMesh, forest.branches);
  }, [
    branchGeometry,
    branchMesh,
    canopyGeometry,
    canopyMesh,
    coneGeometry,
    coneMesh,
    forest,
    trunkGeometry,
    trunkMesh,
  ]);

  const snowColour = palette.snow;
  const glowColour = palette.waterGlow;
  const glowing = layout.greatTree.glowing;
  useLayoutEffect(() => {
    if (moteMesh) placeMotes(moteMesh, glowColour);

    for (const mesh of foliageMeshes) {
      const uniforms = foliageUniforms(mesh);
      if (!uniforms) continue;
      uniforms.uSnow.value = snowColour ? 1 : 0;
      uniforms.uSnowColor.value.set(snowColour ?? "#ffffff");
      uniforms.uGlow.value = glowing ? 0.25 : 0;
      uniforms.uGlowColor.value.set(glowColour);
    }
  }, [foliageMeshes, glowColour, glowing, moteMesh, snowColour]);

  const windEnabled = !reducedMotion && quality !== "low";
  const windTarget = weather === "wind" ? 1 : weather === "rain" ? 0.6 : 0.35;

  useFrame((state, delta) => {
    if (glowing && !reducedMotion && moteRef.current) {
      const t = state.clock.elapsedTime;
      moteRef.current.rotation.y = t * 0.22;
      moteRef.current.position.y = Math.sin(t * 0.8) * 0.08;
    }
    if (!windEnabled) return;
    // Ease toward the weather's wind so a change never snaps the canopy.
    swayLevel.current += (windTarget - swayLevel.current) * Math.min(1, delta * 1.5);
    for (const mesh of foliageMeshes) {
      const uniforms = foliageUniforms(mesh);
      if (!uniforms) continue;
      uniforms.uTime.value = state.clock.elapsedTime;
      uniforms.uSway.value = swayLevel.current;
    }
  });

  const great = layout.greatTree;

  const selectYearTree = (index: number) => {
    const tree = layout.yearTrees[index];
    const info = forest.years[index];
    if (!tree || !info) return;
    onSelect?.({
      kind: "tree",
      id: `year-tree-${tree.year}`,
      title: `${tree.year}`,
      subtitle: "A year of contributions",
      description: `This tree grew from every contribution made in ${tree.year}.`,
      accent: info.accent,
      worldPosition: [tree.x, info.rootY + info.height * tree.scale * 0.75, tree.z],
      details: [
        { label: "Contributions", value: tree.total.toLocaleString() },
        { label: "Busiest month", value: MONTHS[tree.busiestMonth] ?? "—" },
        { label: "Active days", value: tree.activeDays.toLocaleString() },
      ],
      count: tree.total,
    });
  };

  const selectGreatTree = () => {
    onSelect?.({
      kind: great.glowing ? "achievement" : "tree",
      id: "great-tree",
      title: "Great tree",
      subtitle: "Lifetime contributions",
      description: great.glowing
        ? "Every contribution ever made grew this tree, and a year-long streak set its canopy glowing."
        : "Every contribution ever made grew this tree. It is the oldest landmark in the garden.",
      accent: forest.great.accent,
      worldPosition: [great.x, forest.great.rootY + 4.4 * great.scale, great.z],
      details: [
        { label: "Lifetime contributions", value: layout.lifetime.toLocaleString() },
        { label: "Longest streak", value: `${stats.streak.toLocaleString()} days` },
        { label: "Years growing", value: layout.spanYears },
      ],
      count: layout.lifetime,
    });
  };

  const selectOwner = (owners: number[]) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const owner = event.instanceId === undefined ? undefined : owners[event.instanceId];
    if (owner === undefined) return;
    if (owner === GREAT) selectGreatTree();
    else selectYearTree(owner);
  };

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

  const shadows = tier.shadows;
  const { canopy, cones, trunks, branches } = forest;

  return (
    <group name="trees">
      {canopy.owners.length > 0 ? (
        <instancedMesh
          key={`canopy-${canopy.owners.length}`}
          ref={setCanopyMesh}
          args={[canopyGeometry, canopyMaterial, canopy.owners.length]}
          castShadow={shadows}
          receiveShadow={shadows}
          onClick={selectOwner(canopy.owners)}
          {...cursorHandlers}
        />
      ) : null}
      {cones.owners.length > 0 ? (
        <instancedMesh
          key={`cones-${cones.owners.length}`}
          ref={setConeMesh}
          args={[coneGeometry, coneMaterial, cones.owners.length]}
          castShadow={shadows}
          receiveShadow={shadows}
          onClick={selectOwner(cones.owners)}
          {...cursorHandlers}
        />
      ) : null}
      {trunks.owners.length > 0 ? (
        <instancedMesh
          key={`trunks-${trunks.owners.length}`}
          ref={setTrunkMesh}
          args={[trunkGeometry, woodMaterial, trunks.owners.length]}
          castShadow={shadows}
          receiveShadow={shadows}
          onClick={selectOwner(trunks.owners)}
          {...cursorHandlers}
        />
      ) : null}
      {branches.owners.length > 0 ? (
        <instancedMesh
          key={`branches-${branches.owners.length}`}
          ref={setBranchMesh}
          args={[branchGeometry, woodMaterial, branches.owners.length]}
          castShadow={shadows}
          receiveShadow={shadows}
          onClick={selectOwner(branches.owners)}
          {...cursorHandlers}
        />
      ) : null}
      <mesh
        geometry={greatWood}
        material={woodMaterial}
        position={[great.x, forest.great.rootY, great.z]}
        rotation={[0, forest.great.rotation, 0]}
        scale={forest.great.scale}
        castShadow={shadows}
        receiveShadow={shadows}
        onClick={(event) => {
          event.stopPropagation();
          selectGreatTree();
        }}
        {...cursorHandlers}
      />
      {glowing ? (
        <group
          position={[great.x, forest.great.rootY, great.z]}
          scale={forest.great.scale}
        >
          <group ref={moteRef}>
            <instancedMesh
              ref={setMoteMesh}
              args={[moteGeometry, moteMaterial, MOTE_COUNT]}
              raycast={() => null}
            />
          </group>
        </group>
      ) : null}
    </group>
  );
}
