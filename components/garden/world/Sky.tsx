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
  /** Island radius; the sun's shadow camera and the cloud sea fit it. */
  islandRadius?: number;
  /**
   * The default camera's azimuth (radians, atan2(z, x)). Clouds gather on
   * the far side of the island from it, clear of the frame edges.
   */
  viewAzimuth?: number;
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
/**
 * Where each sky colour sits, as the elevation in degrees of the view ray
 * from the camera: deep zenith, zenith, upper, lower, horizon glow, haze.
 *
 * The island floats high above a cloud sea and the default camera looks down
 * at about 32°, so the frame spans roughly −11° (top) to −53° (bottom). The
 * gradient is laid out across that band: blue overhead at the top of the
 * frame, warming to the glow just above the clouds at the bottom. Orbiting
 * lower brings more of the zenith into view, as a real sky would.
 */
const SKY_STOPS = [20, -8, -20, -31, -42, -60];

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
  viewAzimuth = Math.PI / 4,
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
      <SkyDome palette={palette} timeOfDay={timeOfDay} weather={weather} />
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
        count={tier.clouds}
        islandRadius={islandRadius}
        palette={palette}
        reducedMotion={reducedMotion}
        seed={seed + 3}
        sun={SUN_POSITIONS[timeOfDay]}
        timeOfDay={timeOfDay}
        viewAzimuth={viewAzimuth}
        weather={weather}
      />
    </>
  );
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uColors[6];
uniform float uStops[6];
varying vec3 vWorld;

float skyHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 direction = normalize(vWorld - cameraPosition);
  float elevation = degrees(asin(clamp(direction.y, -1.0, 1.0)));
  vec3 color = uColors[0];
  for (int index = 1; index < 6; index++) {
    float t = clamp(
      (uStops[index - 1] - elevation) / (uStops[index - 1] - uStops[index]),
      0.0,
      1.0
    );
    color = mix(color, uColors[index], t * t * (3.0 - 2.0 * t));
  }
  // A little noise so the long, soft gradient doesn't band.
  color += (skyHash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * The sky: a gradient by view direction, so it reads the same from any orbit
 * distance (vertex colours on the dome would warp with the camera's offset
 * from its centre). Drawn first, with no depth, and never tone-mapped.
 */
function SkyDome({
  palette,
  timeOfDay,
  weather,
}: {
  palette: WorldPalette;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
}) {
  const geometry = useMemo(() => new THREE.SphereGeometry(DOME_RADIUS, 32, 16), []);
  const colors = useMemo(() => {
    const tinted = (hex: string) => weatherTinted(hex, weather, palette.fog);
    const zenith = tinted(palette.sky);
    return [
      zenith.clone().multiplyScalar(timeOfDay === "night" ? 0.7 : 0.88),
      zenith,
      tinted(palette.skyMid),
      tinted(palette.skyLow),
      tinted(palette.horizon),
      tinted(palette.fog),
    ];
  }, [palette, timeOfDay, weather]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        name: "sky",
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: {
          uColors: { value: colors },
          uStops: { value: SKY_STOPS },
        },
        depthTest: false,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    [colors],
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

/** Cloud colours by time of day: sunlit top, sun-facing warmth, underside. */
const CLOUD_LIGHT: Record<GardenTimeOfDay, { top: string; sun: string; under: string }> = {
  morning: { top: "#fffaf4", sun: "#ffe2d2", under: "#dcd9ef" },
  day: { top: "#ffffff", sun: "#fffbef", under: "#dbe6f2" },
  sunset: { top: "#fff3e2", sun: "#ffd3a2", under: "#cfc2e4" },
  night: { top: "#5c6888", sun: "#6c7a9c", under: "#2c3753" },
};

const CLOUD_VERTEX = /* glsl */ `
varying vec3 vNormalWorld;
varying vec3 vWorld;
varying float vShade;
void main() {
  mat4 model = modelMatrix * instanceMatrix;
  vec4 world = model * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalWorld = normalize(mat3(model) * normal);
  #ifdef USE_INSTANCING_COLOR
    vShade = instanceColor.r;
  #else
    vShade = 1.0;
  #endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uSun;
uniform vec3 uUnder;
uniform vec3 uSunDirection;
uniform float uOpacity;
varying vec3 vNormalWorld;
varying vec3 vWorld;
varying float vShade;

void main() {
  vec3 normal = normalize(vNormalWorld);
  vec3 toCamera = normalize(cameraPosition - vWorld);
  // Bright tops, a soft lavender (or blue-grey) underside, warmth where the
  // sun strikes.
  float up = smoothstep(-0.95, 0.25, normal.y);
  vec3 color = mix(uUnder, uTop, up);
  float sunlit = max(dot(normal, uSunDirection), 0.0);
  color = mix(color, uSun, sunlit * sunlit * 0.5);
  color *= vShade;
  // Fade toward the silhouette so every puff has a soft, feathered edge.
  float facing = abs(dot(normal, toCamera));
  float alpha = pow(smoothstep(0.0, 0.85, facing), 1.4) * uOpacity;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

/**
 * Soft, bright clouds. Each is a bank of 6–8 overlapping puffs with feathered
 * edges. Half form a cloud sea below and behind the island's rim, peeking out
 * under it; the rest float high in the far sky behind it, above the default
 * frame. Both stay on the far side of the island from the default camera so
 * nothing sits as a blob at the frame edges. All puffs share one instanced
 * draw and drift gently back and forth.
 */
function SoftClouds({
  count,
  islandRadius,
  palette,
  reducedMotion,
  seed,
  sun,
  timeOfDay,
  viewAzimuth,
  weather,
}: {
  count: number;
  islandRadius: number;
  palette: WorldPalette;
  reducedMotion: boolean;
  seed: number;
  sun: VectorTuple;
  timeOfDay: GardenTimeOfDay;
  viewAzimuth: number;
  weather: GardenWeather;
}) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const puffs = useMemo(() => {
    const random = mulberry32(seed);
    const items: CloudPuff[] = [];
    const back = viewAzimuth + Math.PI;
    const far = Math.floor(count / 2);
    const low = count - far;
    for (let cloud = 0; cloud < count; cloud += 1) {
      const isLow = cloud < low;
      const slot = isLow ? cloud : cloud - low;
      const slots = isLow ? low : far;
      // Spread the banks across an arc behind the island.
      const spread = isLow ? 1.5 : 1.3;
      const along = slots <= 1 ? 0 : slot / (slots - 1) - 0.5;
      const angle = back + along * spread + (random() - 0.5) * 0.25;
      const radius = isLow
        ? islandRadius + 4 + random() * 4
        : 38 + random() * 6;
      const height = isLow ? -8.5 + random() * 2.5 : 16 + random() * 5;
      const size = isLow ? 2.4 + random() * 0.9 : 3.2 + random() * 1.4;
      const centerX = Math.cos(angle) * radius;
      const centerZ = Math.sin(angle) * radius;
      // Spread puffs along the ring's tangent so each cloud reads as a bank.
      const tangentX = -Math.sin(angle);
      const tangentZ = Math.cos(angle);
      // A bank of overlapping puffs, rounder and higher towards its crown,
      // so it reads as one soft cumulus rather than a row of bubbles.
      const puffCount = 6 + Math.floor(random() * 3);
      for (let puff = 0; puff < puffCount; puff += 1) {
        const t = puff / (puffCount - 1) - 0.5;
        const offset = t * size * 3 + (random() - 0.5) * size * 0.4;
        const crown = 1 - Math.abs(t) * 1.4;
        const scale = size * (0.45 + crown * 0.4 + random() * 0.18);
        items.push({
          x: centerX + tangentX * offset + (random() - 0.5) * size * 0.7,
          y: height + crown * size * 0.42 + (random() - 0.3) * size * 0.2,
          z: centerZ + tangentZ * offset + (random() - 0.5) * size * 0.7,
          sx: scale * (1.1 + random() * 0.3),
          sy: scale * (0.55 + crown * 0.2 + random() * 0.1),
          sz: scale * (1.0 + random() * 0.25),
          shade: crown,
        });
      }
    }
    return items;
  }, [count, islandRadius, seed, viewAzimuth]);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 20, 14), []);
  const uniforms = useMemo(() => {
    const light = CLOUD_LIGHT[timeOfDay];
    const season = new THREE.Color(palette.cloud);
    const tinted = (hex: string) => {
      const color = weatherTinted(hex, weather, palette.fog);
      if (weather === "rain") color.lerp(new THREE.Color("#7d8b93"), 0.35);
      return color;
    };
    return {
      uTop: { value: tinted(light.top).multiply(season) },
      uSun: { value: tinted(light.sun).multiply(season) },
      uUnder: { value: tinted(light.under) },
      uSunDirection: { value: new THREE.Vector3(...sun).normalize() },
      uOpacity: { value: timeOfDay === "night" ? 0.7 : 0.94 },
    };
  }, [palette.cloud, palette.fog, sun, timeOfDay, weather]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        name: "cloud",
        vertexShader: CLOUD_VERTEX,
        fragmentShader: CLOUD_FRAGMENT,
        uniforms,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [uniforms],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useLayoutEffect(() => {
    const current = mesh.current;
    if (!current) return;
    const dummy = new THREE.Object3D();
    const shade = new THREE.Color();
    puffs.forEach((puff, index) => {
      dummy.position.set(puff.x, puff.y, puff.z);
      dummy.scale.set(puff.sx, puff.sy, puff.sz);
      dummy.updateMatrix();
      current.setMatrixAt(index, dummy.matrix);
      // Crown puffs a touch brighter than the bank's flanks.
      const value = 0.93 + puff.shade * 0.07;
      current.setColorAt(index, shade.setRGB(value, value, value));
    });
    current.instanceMatrix.needsUpdate = true;
    if (current.instanceColor) current.instanceColor.needsUpdate = true;
    current.computeBoundingSphere();
  }, [puffs]);

  useFrame((state) => {
    if (!group.current || reducedMotion) return;
    // A slow sway rather than a full turn, so the banks stay behind the
    // island instead of drifting round to the frame edges.
    const speed = weather === "wind" ? 0.09 : 0.03;
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * speed) * 0.12;
  });

  return (
    <group ref={group} name="clouds">
      <instancedMesh
        ref={mesh}
        // The material goes in as a prop, not an argument, so a new palette
        // swaps it in place instead of rebuilding the mesh and its matrices.
        args={[geometry, undefined, puffs.length]}
        frustumCulled={false}
        material={material}
        renderOrder={-50}
      />
    </group>
  );
}
