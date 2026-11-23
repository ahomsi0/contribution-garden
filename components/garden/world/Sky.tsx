"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { GardenTimeOfDay, GardenWeather } from "../types";
import type { WorldPalette } from "./palette";
import type { TierSettings } from "./tiers";

type VectorTuple = [number, number, number];

export interface SkyAndLightsProps {
  palette: WorldPalette;
  tier: TierSettings;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
  reducedMotion: boolean;
  seed: number;
  /**
   * Stretches the fog range with the default camera distance, so an island
   * framed from further away is no hazier than one framed close up.
   */
  fogScale?: number;
  /** Island radius; the sun's shadow camera is fitted to it. */
  islandRadius?: number;
}

const DOME_RADIUS = 54;
/**
 * The shadow camera covers the island plus this much, enough for a year
 * tree's crown overhanging the rim.
 */
const SHADOW_MARGIN = 2.5;
/**
 * The shadow map is redrawn every this many frames rather than every frame.
 * Nothing that casts a shadow moves quickly (canopy sway is applied after the
 * shadow pass's depth material, so it never reaches the map), and the pass
 * costs about 4 ms on high, so a refresh every fourth frame keeps growth and
 * season changes current at a quarter of the cost.
 */
const SHADOW_UPDATE_INTERVAL = 4;
/** Dome height (−1..1) of the warm horizon band. */
const HORIZON_HEIGHT = -0.2;

const SUN_POSITIONS: Record<GardenTimeOfDay, VectorTuple> = {
  morning: [-9, 11, 10],
  day: [11, 16, 9],
  sunset: [-13, 7.5, -7],
  night: [-11, 14, -13],
};

/** Overcast tint applied to sky, fog and clouds for grey weather. */
const WEATHER_TINT: Partial<Record<GardenWeather, { color: string; amount: number }>> = {
  rain: { color: "#9aa7ae", amount: 0.45 },
  snow: { color: "#cdd6dd", amount: 0.3 },
};

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function fogRange(weather: GardenWeather, timeOfDay: GardenTimeOfDay) {
  if (weather === "fog") return { near: 7, far: 23 };
  if (weather === "rain" || weather === "snow") return { near: 13, far: 35 };
  if (timeOfDay === "night") return { near: 18, far: 41 };
  return { near: 23, far: 50 };
}

function weatherTinted(hex: string, weather: GardenWeather, fog: string) {
  const color = new THREE.Color(hex);
  if (weather === "fog") return color.lerp(new THREE.Color(fog), 0.55);
  const tint = WEATHER_TINT[weather];
  if (tint) color.lerp(new THREE.Color(tint.color), tint.amount);
  return color;
}

export function SkyAndLights({
  palette,
  tier,
  timeOfDay,
  weather,
  reducedMotion,
  seed,
  fogScale = 1,
  islandRadius = 11.5,
}: SkyAndLightsProps) {
  const fog = fogRange(weather, timeOfDay);
  const skyColor = useMemo(
    () => `#${weatherTinted(palette.sky, weather, palette.fog).getHexString()}`,
    [palette.fog, palette.sky, weather],
  );
  // The island floats over bright cloud, so light bouncing up onto the cliffs
  // is the earth tone lifted toward the horizon glow, not bare dark soil.
  const bounceColor = useMemo(
    () =>
      `#${new THREE.Color(palette.hemiGround)
        .lerp(new THREE.Color(palette.horizon), 0.45)
        .getHexString()}`,
    [palette.hemiGround, palette.horizon],
  );
  const fogColor = useMemo(
    () => `#${weatherTinted(palette.fog, weather, palette.fog).getHexString()}`,
    [palette.fog, weather],
  );

  return (
    <>
      <color attach="background" args={[skyColor]} />
      <fog
        attach="fog"
        args={[fogColor, fog.near * fogScale, fog.far * fogScale]}
      />
      <SkyDome
        fog={fogColor}
        horizon={palette.horizon}
        sky={skyColor}
        timeOfDay={timeOfDay}
        weather={weather}
      />
      <hemisphereLight
        args={[palette.hemiSky, bounceColor, palette.hemiIntensity]}
      />
      <KeyLight
        color={palette.sun}
        intensity={palette.sunIntensity * (weather === "rain" ? 0.7 : 1)}
        position={SUN_POSITIONS[timeOfDay]}
        shadowExtent={islandRadius + SHADOW_MARGIN}
        tier={tier}
      />
      <directionalLight
        color={palette.fill}
        intensity={palette.fillIntensity}
        position={[-7, 8, 12]}
      />
      <SoftClouds
        color={palette.cloud}
        count={tier.clouds}
        reducedMotion={reducedMotion}
        seed={seed + 3}
        timeOfDay={timeOfDay}
        weather={weather}
      />
    </>
  );
}

function SkyDome({
  fog,
  horizon,
  sky,
  timeOfDay,
  weather,
}: {
  fog: string;
  horizon: string;
  sky: string;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
}) {
  const geometry = useMemo(() => {
    const sphere = new THREE.SphereGeometry(DOME_RADIUS, 48, 24);
    const positions = sphere.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const zenith = new THREE.Color(sky);
    const warmHorizon = weatherTinted(horizon, weather, fog);
    const below = new THREE.Color(fog);
    // A slightly deeper zenith gives the gradient some depth without dulling it.
    const deepZenith = zenith
      .clone()
      .multiplyScalar(timeOfDay === "night" ? 0.7 : 0.9);
    const color = new THREE.Color();

    for (let index = 0; index < positions.count; index += 1) {
      const height = positions.getY(index) / DOME_RADIUS;
      // The island floats high, so the warm horizon glow sits below eye
      // level. That keeps sky colour in the top of the default orbit view,
      // which looks down at the island, and haze toward the bottom.
      if (height >= HORIZON_HEIGHT) {
        color
          .copy(warmHorizon)
          .lerp(zenith, smoothstep(HORIZON_HEIGHT, 0.28, height))
          .lerp(deepZenith, smoothstep(0.4, 1, height));
      } else {
        color
          .copy(warmHorizon)
          .lerp(below, smoothstep(HORIZON_HEIGHT, -0.7, height));
      }
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    sphere.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return sphere;
  }, [fog, horizon, sky, timeOfDay, weather]);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        depthTest: false,
        depthWrite: false,
        fog: false,
        side: THREE.BackSide,
        toneMapped: false,
        vertexColors: true,
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh
      name="sky-dome"
      frustumCulled={false}
      geometry={geometry}
      material={material}
      renderOrder={-100}
    />
  );
}

function KeyLight({
  color,
  intensity,
  position,
  shadowExtent,
  tier,
}: {
  color: string;
  intensity: number;
  position: VectorTuple;
  shadowExtent: number;
  tier: TierSettings;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const getThree = useThree((state) => state.get);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const current = light.current;
    if (!current) return;
    const { shadow } = current;
    const camera = shadow.camera;
    camera.left = -shadowExtent;
    camera.right = shadowExtent;
    camera.top = shadowExtent;
    camera.bottom = -shadowExtent;
    camera.near = 0.5;
    camera.far = 60;
    camera.updateProjectionMatrix();
    const size = Math.max(512, tier.shadowMapSize);
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      // A resized map must be reallocated on the next shadow pass.
      shadow.map?.dispose();
      shadow.map = null;
    }
    shadow.bias = -0.0004;
    shadow.normalBias = 0.025;
    shadow.radius = tier.shadowMapSize >= 2048 ? 3 : 1.5;
    shadow.needsUpdate = true;
    getThree().gl.shadowMap.needsUpdate = true;
  }, [getThree, shadowExtent, tier.shadowMapSize]);

  // Redraw the shadow map on a schedule instead of every frame.
  useLayoutEffect(() => {
    if (!tier.shadows) return;
    const { shadowMap } = getThree().gl;
    shadowMap.autoUpdate = false;
    shadowMap.needsUpdate = true;
    return () => {
      shadowMap.autoUpdate = true;
    };
  }, [getThree, tier.shadows]);
  useFrame((state) => {
    if (!tier.shadows) return;
    frame.current = (frame.current + 1) % SHADOW_UPDATE_INTERVAL;
    if (frame.current === 0) state.gl.shadowMap.needsUpdate = true;
  });

  return (
    <directionalLight
      ref={light}
      castShadow={tier.shadows}
      color={color}
      intensity={intensity}
      position={position}
    />
  );
}

interface CloudPuff {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  shade: number;
}

/**
 * Soft, lit clouds: each is a cluster of 4–6 spheres. Half form a cloud sea
 * below the island's rim; the rest float far out in the sky behind it. Both
 * bands sit outside every camera's line of sight to the island. All puffs
 * share one instanced draw call and drift together on a slow ring.
 */
function SoftClouds({
  color,
  count,
  reducedMotion,
  seed,
  timeOfDay,
  weather,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  seed: number;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
}) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const puffs = useMemo(() => {
    const random = mulberry32(seed);
    const items: CloudPuff[] = [];
    for (let cloud = 0; cloud < count; cloud += 1) {
      const low = cloud % 2 === 0;
      const angle = (cloud / Math.max(1, count)) * Math.PI * 2 + random() * 0.6;
      const radius = low ? 16 + random() * 6 : 36 + random() * 6;
      const height = low ? -7.5 + random() * 3 : 11 + random() * 5;
      const size = low ? 1.7 + random() * 0.8 : 2.6 + random() * 1.4;
      const centerX = Math.cos(angle) * radius;
      const centerZ = Math.sin(angle) * radius;
      // Spread puffs along the ring's tangent so each cloud reads as a bank.
      const tangentX = -Math.sin(angle);
      const tangentZ = Math.cos(angle);
      const puffCount = 4 + Math.floor(random() * 3);
      for (let puff = 0; puff < puffCount; puff += 1) {
        const along = (puff / (puffCount - 1) - 0.5) * size * 2.6;
        const crown = 1 - Math.abs(puff / (puffCount - 1) - 0.5) * 1.1;
        const scale = size * (0.62 + crown * 0.42 + random() * 0.18);
        items.push({
          x: centerX + tangentX * along + (random() - 0.5) * size * 0.5,
          y: height + crown * size * 0.32 + (random() - 0.5) * 0.3,
          z: centerZ + tangentZ * along + (random() - 0.5) * size * 0.5,
          sx: scale * (1.15 + random() * 0.3),
          sy: scale * (0.58 + random() * 0.14),
          sz: scale * (0.95 + random() * 0.25),
          shade: crown,
        });
      }
    }
    return items;
  }, [count, seed]);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 18, 12), []);
  const tint = useMemo(() => {
    const base = weatherTinted(color, weather, color);
    if (weather === "rain") base.lerp(new THREE.Color("#7d8b93"), 0.35);
    if (timeOfDay === "night") base.multiplyScalar(0.45);
    return base;
  }, [color, timeOfDay, weather]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        name: "cloud",
        roughness: 1,
        metalness: 0,
        fog: false,
        // The undersides would otherwise pick up the hemisphere's earth
        // tone; a little self-light keeps the clouds soft and bright.
        emissive: tint,
        emissiveIntensity: timeOfDay === "night" ? 0.15 : 0.5,
      }),
    [timeOfDay, tint],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useLayoutEffect(() => {
    const current = mesh.current;
    if (!current) return;
    const dummy = new THREE.Object3D();
    const shaded = new THREE.Color();
    const shadow = tint.clone().lerp(new THREE.Color("#c8d3de"), 0.3);
    puffs.forEach((puff, index) => {
      dummy.position.set(puff.x, puff.y, puff.z);
      dummy.scale.set(puff.sx, puff.sy, puff.sz);
      dummy.updateMatrix();
      current.setMatrixAt(index, dummy.matrix);
      current.setColorAt(index, shaded.copy(shadow).lerp(tint, 0.55 + puff.shade * 0.45));
    });
    current.instanceMatrix.needsUpdate = true;
    if (current.instanceColor) current.instanceColor.needsUpdate = true;
    current.computeBoundingSphere();
  }, [puffs, tint]);

  useFrame((_, delta) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y += Math.min(delta, 0.1) * (weather === "wind" ? 0.014 : 0.004);
  });

  return (
    <group ref={group} name="clouds">
      <instancedMesh
        ref={mesh}
        args={[geometry, undefined, puffs.length]}
        frustumCulled={false}
        material={material}
      />
    </group>
  );
}
