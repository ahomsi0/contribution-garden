"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { PhotorealIslandSurfaceSampler } from "../photoreal-geometry";
import type { GardenTimeOfDay } from "../types";
import type { FloraCircle } from "./flora-layout";
import { ISLAND_SURFACE_OFFSET } from "./Island";
import type { GardenLayout } from "./mapping";
import { seededRandom } from "./meadow-layout";
import type { WorldPalette } from "./palette";

export interface LifeProps {
  layout: GardenLayout;
  palette: WorldPalette;
  timeOfDay: GardenTimeOfDay;
  reducedMotion: boolean;
  seed: number;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  /** Wildflower clusters the butterflies wander between. */
  flowerClusters: ReadonlyArray<FloraCircle>;
}

const TAU = Math.PI * 2;
/** Clusters on one butterfly's looping route. */
const ROUTE_STOPS = 7;
/** Seconds a butterfly lingers over a cluster. */
const HOVER_TIME = 1.6;
const BIRD_COLOUR = "#27313a";
const FIREFLY_GLOW = new THREE.Color("#ffd35c");
/** Firefly opacity at day and morning, so a streak still shows. */
const FIREFLY_DAY_OPACITY = 0.35;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * One butterfly wing, hinged on the z axis (the body line, +z forward) and
 * spreading along +x in the xz plane. A dark sliver of body along the hinge
 * rides with each wing, so a butterfly is two instances and no extra mesh.
 * Vertex colours are white on the wing (tinted per instance) and near black
 * on the body.
 */
function createButterflyWingGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const fan = (points: [number, number][], shade: (x: number) => number) => {
    const [cx, cz] = points[0];
    for (let k = 1; k < points.length - 1; k += 1) {
      for (const [x, z] of [points[0], points[k], points[k + 1]]) {
        positions.push(x, 0, z);
        const s = shade(x);
        colors.push(s, s, s);
      }
    }
    return [cx, cz];
  };
  // Darker toward the hinge, bright at the tips.
  const wingShade = (x: number) => 0.62 + Math.min(1, x / 0.6) * 0.42;
  // Forewing: broad and swept forward.
  fan(
    [
      [0.03, 0.02],
      [0.04, 0.16],
      [0.3, 0.42],
      [0.55, 0.44],
      [0.62, 0.3],
      [0.42, 0.06],
      [0.1, -0.02],
    ],
    wingShade,
  );
  // Hindwing: rounder and tucked behind.
  fan(
    [
      [0.03, -0.02],
      [0.12, 0.0],
      [0.38, -0.1],
      [0.42, -0.26],
      [0.26, -0.4],
      [0.08, -0.34],
      [0.03, -0.18],
    ],
    wingShade,
  );
  // Half a body along the hinge.
  fan(
    [
      [0, 0.24],
      [0.035, 0.18],
      [0.035, -0.3],
      [0, -0.36],
    ],
    () => 0.06,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One bird wing: a swept blade hinged on the z axis (+z forward) reaching
 * out along +x, with half of a stubby body. Two mirrored instances make the V.
 */
function createBirdWingGeometry() {
  const positions = [
    // Wing: leading edge forward, swept tip.
    0, 0, 0.12, 0.42, 0, -0.06, 0.62, 0, -0.2,
    0, 0, 0.12, 0.62, 0, -0.2, 0.0, 0, -0.14,
    // Half body: a thin wedge from beak to tail.
    0, 0, 0.3, 0.05, 0, 0.0, 0, 0, -0.3,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** A soft round glow for the firefly points: bright core, gentle falloff. */
function createGlowTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const core = Math.max(0, 1 - r / 0.32);
      const halo = Math.pow(1 - r, 1.8);
      const value = Math.min(1, core * 1.2 + halo * 0.6);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(value * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Butterflies
// ---------------------------------------------------------------------------

interface ButterflyRoute {
  /** Stop positions: x, ground-relative y, z per stop. */
  stops: Float32Array;
  /** Time each leg (hover, then fly to the next stop) starts. */
  starts: Float32Array;
  /** Seconds spent flying each leg. */
  flights: Float32Array;
  period: number;
  phase: number;
  flapRate: number;
  wobble: number;
  size: number;
}

function groundY(sampler: PhotorealIslandSurfaceSampler, x: number, z: number) {
  return (sampler(x, z) ?? 0) + ISLAND_SURFACE_OFFSET;
}

/** Places to visit: the flower clusters, or a ring over the meadow without them. */
function butterflyStops(
  clusters: ReadonlyArray<FloraCircle>,
  islandRadius: number,
  random: () => number,
) {
  if (clusters.length >= 3) return clusters;
  const extra: FloraCircle[] = [...clusters];
  for (let k = extra.length; k < 6; k += 1) {
    const angle = random() * TAU;
    const radius = 3 + random() * (islandRadius * 0.6 - 3);
    extra.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius: 0.4 });
  }
  return extra;
}

function createButterflyRoutes(
  count: number,
  clusters: ReadonlyArray<FloraCircle>,
  islandRadius: number,
  sampler: PhotorealIslandSurfaceSampler,
  seed: number,
): ButterflyRoute[] {
  const random = seededRandom(seed);
  const places = butterflyStops(clusters, islandRadius, random);
  const routes: ButterflyRoute[] = [];
  for (let b = 0; b < count; b += 1) {
    const stops = new Float32Array(ROUTE_STOPS * 3);
    const starts = new Float32Array(ROUTE_STOPS + 1);
    const flights = new Float32Array(ROUTE_STOPS);
    const speed = 0.55 + random() * 0.35;
    let current = Math.floor(random() * places.length);
    for (let s = 0; s < ROUTE_STOPS; s += 1) {
      const place = places[current];
      // Hover somewhere over the cluster, not always its exact centre.
      const angle = random() * TAU;
      const reach = Math.sqrt(random()) * place.radius;
      const x = place.x + Math.cos(angle) * reach;
      const z = place.z + Math.sin(angle) * reach;
      stops[s * 3] = x;
      stops[s * 3 + 1] = groundY(sampler, x, z) + 0.6 + random() * 1.0;
      stops[s * 3 + 2] = z;
      // Next: one of the three nearest other clusters, so routes stay local
      // but still drift across the island over a few legs.
      const options = places
        .map((other, p) => ({ p, d: Math.hypot(other.x - place.x, other.z - place.z) }))
        .filter((entry) => entry.p !== current)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map((entry) => entry.p);
      current = options[Math.floor(random() * options.length)] ?? current;
    }
    let time = 0;
    for (let s = 0; s < ROUTE_STOPS; s += 1) {
      const n = (s + 1) % ROUTE_STOPS;
      const distance = Math.hypot(
        stops[n * 3] - stops[s * 3],
        stops[n * 3 + 2] - stops[s * 3 + 2],
      );
      starts[s] = time;
      flights[s] = Math.max(1.2, distance / speed);
      time += HOVER_TIME * (0.6 + random() * 0.8) + flights[s];
    }
    starts[ROUTE_STOPS] = time;
    routes.push({
      stops,
      starts,
      flights,
      period: time,
      phase: random() * time,
      flapRate: 11 + random() * 5,
      wobble: random() * TAU,
      size: 0.95 + random() * 0.3,
    });
  }
  return routes;
}

const butterflyBody = new THREE.Object3D();
butterflyBody.rotation.order = "YXZ";

/**
 * Writes the two wing instances of butterfly `index` at `time`. With `still`
 * it parks over its first cluster with half-open wings.
 */
function poseButterfly(
  mesh: THREE.InstancedMesh,
  index: number,
  route: ButterflyRoute,
  time: number,
  still: boolean,
) {
  const { stops, starts, flights } = route;
  let t = still ? 0 : (time + route.phase) % route.period;
  let leg = 0;
  while (leg < ROUTE_STOPS - 1 && t >= starts[leg + 1]) leg += 1;
  t -= starts[leg];
  const hover = starts[leg + 1] - starts[leg] - flights[leg];
  const next = (leg + 1) % ROUTE_STOPS;
  const ax = stops[leg * 3];
  const ay = stops[leg * 3 + 1];
  const az = stops[leg * 3 + 2];
  const dx = stops[next * 3] - ax;
  const dy = stops[next * 3 + 1] - ay;
  const dz = stops[next * 3 + 2] - az;
  const f = t <= hover ? 0 : smoothstep(Math.min(1, (t - hover) / flights[leg]));
  // Lazy loops and bobbing on top of the leg, strongest mid-flight.
  const w = still ? 0 : time * 0.9 + route.wobble;
  const sway = Math.sin(f * Math.PI) * 0.6 + 0.18;
  const x = ax + dx * f + Math.sin(w * 1.3) * sway;
  const y = ay + dy * f + Math.sin(w * 2.7) * 0.12;
  const z = az + dz * f + Math.cos(w * 1.1) * sway;
  const yaw = Math.atan2(dx, dz) + (still ? 0 : Math.sin(w * 0.8) * 0.5);
  const flap = still ? 0.55 : 0.2 + Math.abs(Math.sin(time * route.flapRate + route.wobble)) * 1.15;

  butterflyBody.position.set(x, y, z);
  butterflyBody.scale.setScalar(route.size);
  butterflyBody.rotation.set(-0.25, yaw, flap);
  butterflyBody.updateMatrix();
  mesh.setMatrixAt(index * 2, butterflyBody.matrix);
  butterflyBody.rotation.set(-0.25, yaw, Math.PI - flap);
  butterflyBody.updateMatrix();
  mesh.setMatrixAt(index * 2 + 1, butterflyBody.matrix);
}

function Butterflies({
  count,
  clusters,
  islandRadius,
  palette,
  reducedMotion,
  sampler,
  seed,
}: {
  count: number;
  clusters: ReadonlyArray<FloraCircle>;
  islandRadius: number;
  palette: WorldPalette;
  reducedMotion: boolean;
  sampler: PhotorealIslandSurfaceSampler;
  seed: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => createButterflyWingGeometry(), []);
  const material = useMemo(() => {
    const wings = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0,
    });
    // A little self-light in the wing's own colour keeps butterflies bright
    // and readable in shade, at sunset and from the default camera distance.
    wings.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.35;",
      );
    };
    wings.customProgramCacheKey = () => "life-butterfly-wings";
    return wings;
  }, []);
  const routes = useMemo(
    () => createButterflyRoutes(count, clusters, islandRadius, sampler, seed),
    [clusters, count, islandRadius, sampler, seed],
  );

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const colour = new THREE.Color();
    routes.forEach((route, index) => {
      colour.set(palette.flowers[(index + Math.abs(seed % 4)) % palette.flowers.length]);
      target.setColorAt(index * 2, colour);
      target.setColorAt(index * 2 + 1, colour);
      poseButterfly(target, index, route, 0, true);
    });
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
  }, [palette.flowers, routes, seed]);

  useFrame((state) => {
    const target = mesh.current;
    if (!target || reducedMotion) return;
    const time = state.clock.elapsedTime;
    for (let index = 0; index < routes.length; index += 1) {
      poseButterfly(target, index, routes[index], time, false);
    }
    target.instanceMatrix.needsUpdate = true;
  });

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => () => material.dispose(), [material]);

  return (
    <instancedMesh
      key={routes.length}
      ref={mesh}
      args={[geometry, material, routes.length * 2]}
      castShadow={false}
      frustumCulled={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Birds
// ---------------------------------------------------------------------------

interface BirdFlight {
  radius: number;
  height: number;
  /** Angle behind or ahead of the flock's lead. */
  lag: number;
  flapRate: number;
  phase: number;
  size: number;
}

const birdBody = new THREE.Object3D();
birdBody.rotation.order = "YXZ";

function poseBird(
  mesh: THREE.InstancedMesh,
  index: number,
  bird: BirdFlight,
  time: number,
  lead: number,
  still: boolean,
) {
  const angle = lead - bird.lag;
  const radius = bird.radius + (still ? 0 : Math.sin(time * 0.17 + bird.phase) * 0.5);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = bird.height + (still ? 0 : Math.sin(time * 0.4 + bird.phase) * 0.3);
  // Counter-clockwise from above, so the heading is the tangent (-sin, cos).
  const yaw = Math.atan2(-Math.sin(angle), Math.cos(angle));
  // Flap in bursts, then glide with the wings held up in a shallow V.
  const burst = still ? 0 : Math.max(0, Math.sin(time * 0.6 + bird.phase));
  const flap = 0.32 + Math.sin(time * bird.flapRate + bird.phase) * 0.5 * burst;
  // Bank into the turn.
  const bank = -0.22;

  birdBody.position.set(x, y, z);
  birdBody.scale.setScalar(bird.size);
  birdBody.rotation.set(0, yaw, bank + flap);
  birdBody.updateMatrix();
  mesh.setMatrixAt(index * 2, birdBody.matrix);
  birdBody.rotation.set(0, yaw, bank + Math.PI - flap);
  birdBody.updateMatrix();
  mesh.setMatrixAt(index * 2 + 1, birdBody.matrix);
}

function Birds({
  count,
  reducedMotion,
  seed,
}: {
  count: number;
  reducedMotion: boolean;
  seed: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => createBirdWingGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BIRD_COLOUR,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const { birds, offset } = useMemo(() => {
    const random = seededRandom(seed);
    const list: BirdFlight[] = Array.from({ length: count }, (_, index) => ({
      radius: 6 + random() * 4,
      height: 6 + random() * 3,
      lag: index * 0.16 + random() * 0.12,
      flapRate: 6.5 + random() * 2,
      phase: random() * TAU,
      size: 0.85 + random() * 0.3,
    }));
    return { birds: list, offset: random() * TAU };
  }, [count, seed]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    birds.forEach((bird, index) => poseBird(target, index, bird, 0, offset, true));
    target.instanceMatrix.needsUpdate = true;
  }, [birds, offset]);

  useFrame((state) => {
    const target = mesh.current;
    if (!target || reducedMotion) return;
    const time = state.clock.elapsedTime;
    const lead = offset + time * 0.055;
    for (let index = 0; index < birds.length; index += 1) {
      poseBird(target, index, birds[index], time, lead, false);
    }
    target.instanceMatrix.needsUpdate = true;
  });

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => () => material.dispose(), [material]);

  return (
    <instancedMesh
      key={birds.length}
      ref={mesh}
      args={[geometry, material, birds.length * 2]}
      frustumCulled={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Fireflies
// ---------------------------------------------------------------------------

function Fireflies({
  count,
  greatX,
  greatZ,
  greatScale,
  islandRadius,
  opacity,
  reducedMotion,
  sampler,
  seed,
}: {
  count: number;
  greatX: number;
  greatZ: number;
  /** Rounded by the caller, so the swarm only moves when the tree grows visibly. */
  greatScale: number;
  islandRadius: number;
  opacity: number;
  reducedMotion: boolean;
  sampler: PhotorealIslandSurfaceSampler;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const texture = useMemo(() => createGlowTexture(), []);
  const { base, motion, positions, colors } = useMemo(() => {
    const random = seededRandom(seed);
    const home = new Float32Array(count * 3);
    // Per firefly: bob phase, drift radius, twinkle rate.
    const params = new Float32Array(count * 3);
    const treeShare = Math.ceil(count * 0.55);
    const canopy = 5.5 * greatScale;
    const treeGround = groundY(sampler, greatX, greatZ);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * TAU;
      let x: number;
      let y: number;
      let z: number;
      if (index < treeShare) {
        // Under and around the rim of the great tree's canopy.
        const reach = (0.25 + random() * 0.4) * canopy;
        x = greatX + Math.cos(angle) * reach;
        z = greatZ + Math.sin(angle) * reach;
        y = treeGround + (0.35 + random() * 0.4) * canopy;
      } else {
        // Low over the meadow.
        const radius = 2.6 + Math.sqrt(random()) * Math.max(0.5, islandRadius - 4.2);
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        y = groundY(sampler, x, z) + 0.4 + random() * 1.1;
      }
      home[index * 3] = x;
      home[index * 3 + 1] = y;
      home[index * 3 + 2] = z;
      params[index * 3] = random() * TAU;
      params[index * 3 + 1] = 0.15 + random() * 0.3;
      params[index * 3 + 2] = 1.2 + random() * 1.8;
    }
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const level = 0.6 + 0.4 * Math.sin(params[index * 3]);
      colors[index * 3] = FIREFLY_GLOW.r * level;
      colors[index * 3 + 1] = FIREFLY_GLOW.g * level;
      colors[index * 3 + 2] = FIREFLY_GLOW.b * level;
    }
    return { base: home, motion: params, positions: home.slice(), colors };
  }, [count, greatScale, greatX, greatZ, islandRadius, sampler, seed]);

  useFrame((state) => {
    const target = points.current;
    if (!target || reducedMotion) return;
    const positionAttribute = target.geometry.getAttribute("position");
    const colorAttribute = target.geometry.getAttribute("color");
    const position = positionAttribute.array as Float32Array;
    const color = colorAttribute.array as Float32Array;
    const time = state.clock.elapsedTime;
    for (let index = 0; index < count; index += 1) {
      const i = index * 3;
      const phase = motion[i];
      const drift = motion[i + 1];
      const rate = motion[i + 2];
      position[i] = base[i] + Math.sin(time * 0.35 + phase) * drift;
      position[i + 1] = base[i + 1] + Math.sin(time * 0.9 + phase * 1.7) * 0.18;
      position[i + 2] = base[i + 2] + Math.cos(time * 0.3 + phase * 1.3) * drift;
      // Slow pulses with brief dim spells, like a real firefly's flash.
      const pulse = Math.sin(time * rate + phase);
      const level = 0.25 + 0.75 * Math.max(0, pulse) ** 0.6;
      color[i] = FIREFLY_GLOW.r * level;
      color[i + 1] = FIREFLY_GLOW.g * level;
      color[i + 2] = FIREFLY_GLOW.b * level;
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  });

  useLayoutEffect(() => () => texture.dispose(), [texture]);

  return (
    <points key={count} ref={points} frustumCulled={false} renderOrder={2}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        map={texture}
        opacity={opacity}
        size={0.72}
        sizeAttenuation
        toneMapped={false}
        transparent
        vertexColors
      />
    </points>
  );
}

// ---------------------------------------------------------------------------
// Life
// ---------------------------------------------------------------------------

/**
 * Butterflies, birds and fireflies, on every tier. Butterflies and birds show
 * recent activity; fireflies show a streak of 30 days or more. One instanced
 * mesh per creature and one point cloud: three draw calls at most.
 */
export function Life({
  layout,
  palette,
  timeOfDay,
  reducedMotion,
  seed,
  surfaceSampler,
  flowerClusters,
}: LifeProps) {
  const glowTime = timeOfDay === "sunset" || timeOfDay === "night";
  return (
    <group>
      {layout.butterflyCount > 0 ? (
        <Butterflies
          clusters={flowerClusters}
          count={layout.butterflyCount}
          islandRadius={layout.islandRadius}
          palette={palette}
          reducedMotion={reducedMotion}
          sampler={surfaceSampler}
          seed={seed + 11}
        />
      ) : null}
      {layout.birdCount > 0 ? (
        <Birds count={layout.birdCount} reducedMotion={reducedMotion} seed={seed + 91} />
      ) : null}
      {layout.fireflyCount > 0 ? (
        <Fireflies
          count={layout.fireflyCount}
          greatScale={Math.round(layout.greatTree.scale * 20) / 20}
          greatX={layout.greatTree.x}
          greatZ={layout.greatTree.z}
          islandRadius={layout.islandRadius}
          opacity={glowTime ? 1 : FIREFLY_DAY_OPACITY}
          reducedMotion={reducedMotion}
          sampler={surfaceSampler}
          seed={seed + 181}
        />
      ) : null}
    </group>
  );
}
