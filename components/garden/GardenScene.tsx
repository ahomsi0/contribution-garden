"use client";

import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import type {
  GardenDay,
  GardenQuality,
  GardenSceneProps,
  GardenSeason,
  GardenSelection,
  GardenStats,
  GardenTimeOfDay,
  GardenWalkInput,
  GardenWeather,
} from "./types";
import {
  createPhotorealIslandSurfaceSampler,
  type PhotorealIslandSurfaceSampler,
} from "./photoreal-geometry";
import { Flora, useFloraLayout } from "./world/Flora";
import { flowerClusters } from "./world/flora-layout";
import { Island, ISLAND_SURFACE_OFFSET } from "./world/Island";
import { Life } from "./world/Life";
import {
  computeGardenLayout,
  type GardenLayout,
  type MappingInput,
} from "./world/mapping";
import { Meadow } from "./world/Meadow";
import { isOutsideMeadowPond } from "./world/meadow-layout";
import { worldPalette } from "./world/palette";
import { SkyAndLights } from "./world/Sky";
import { TIER_SETTINGS } from "./world/tiers";
import { Trees } from "./world/Trees";
import { outflowRimPoint, Water } from "./world/Water";

interface GardenPalette {
  sky: string;
  fog: string;
  horizon: string;
  ground: string;
  groundDry: string;
  earth: string;
  cliff: string;
  foliage: [string, string, string, string];
  flowers: [string, string, string, string];
  trunk: string;
  stone: string;
  stoneLight: string;
  water: string;
  waterGlow: string;
  sun: string;
  ambient: string;
  lightIntensity: number;
  ambientIntensity: number;
  mote: string;
}

/** The base pond the walkthrough steers around. */
const WALK_POND = { x: -2.35, z: 1.25, scale: 1 };
const EMPTY_WALK_INPUT: GardenWalkInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};

const SEASON_PALETTES: Record<
  GardenSeason,
  Pick<
    GardenPalette,
    | "ground"
    | "groundDry"
    | "earth"
    | "cliff"
    | "foliage"
    | "flowers"
    | "trunk"
    | "stone"
    | "stoneLight"
    | "water"
    | "waterGlow"
    | "mote"
  >
> = {
  spring: {
    ground: "#70865b",
    groundDry: "#948163",
    earth: "#514237",
    cliff: "#6f665d",
    foliage: ["#294232", "#3c5838", "#526b43", "#71815a"],
    flowers: ["#c89ca8", "#d7c58b", "#9e98b8", "#e3ddd0"],
    trunk: "#584538",
    stone: "#70756e",
    stoneLight: "#a9aca0",
    water: "#4e7374",
    waterGlow: "#89aaa5",
    mote: "#d9cfaa",
  },
  summer: {
    ground: "#71865e",
    groundDry: "#948462",
    earth: "#49392f",
    cliff: "#685d53",
    foliage: ["#233d2e", "#34523a", "#496741", "#657d50"],
    flowers: ["#cea767", "#bd7776", "#d2cfac", "#7fa2aa"],
    trunk: "#504034",
    stone: "#686f6a",
    stoneLight: "#9fa699",
    water: "#456c70",
    waterGlow: "#7da49e",
    mote: "#d8c57c",
  },
  autumn: {
    ground: "#6b7350",
    groundDry: "#8e704d",
    earth: "#49372d",
    cliff: "#65554a",
    foliage: ["#6b4032", "#87513a", "#a56c42", "#b58a53"],
    flowers: ["#b99759", "#a96848", "#d7caa6", "#815b65"],
    trunk: "#4d3a31",
    stone: "#686960",
    stoneLight: "#9e998a",
    water: "#526e6c",
    waterGlow: "#829c92",
    mote: "#c59e62",
  },
  winter: {
    ground: "#c4cdc8",
    groundDry: "#9e9d8d",
    earth: "#49423d",
    cliff: "#69645f",
    foliage: ["#2f443d", "#40564c", "#5d6c62", "#7c8980"],
    flowers: ["#b9c6c8", "#d7dcda", "#9facb5", "#c2b8c6"],
    trunk: "#4c413a",
    stone: "#6b7271",
    stoneLight: "#bbc2bf",
    water: "#6f8b92",
    waterGlow: "#b0c5c6",
    mote: "#dce4e6",
  },
};

const DAY_PALETTES: Record<
  GardenTimeOfDay,
  Pick<
    GardenPalette,
    | "sky"
    | "fog"
    | "horizon"
    | "sun"
    | "ambient"
    | "lightIntensity"
    | "ambientIntensity"
  >
> = {
  morning: {
    sky: "#9eb7b2",
    fog: "#c4ccc4",
    horizon: "#d5b58a",
    sun: "#f5d2a2",
    ambient: "#c5cec7",
    lightIntensity: 2.8,
    ambientIntensity: 0.4,
  },
  day: {
    sky: "#8daeb6",
    fog: "#bdc9c4",
    horizon: "#cbd2bd",
    sun: "#f6e5bb",
    ambient: "#cbd5cd",
    lightIntensity: 3.2,
    ambientIntensity: 0.46,
  },
  sunset: {
    sky: "#857c87",
    fog: "#aa9489",
    horizon: "#c59269",
    sun: "#efae72",
    ambient: "#b9a19a",
    lightIntensity: 2.6,
    ambientIntensity: 0.34,
  },
  night: {
    sky: "#111925",
    fog: "#293440",
    horizon: "#354352",
    sun: "#bdc9dc",
    ambient: "#708097",
    lightIntensity: 0.78,
    ambientIntensity: 0.18,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function paletteFor(season: GardenSeason, timeOfDay: GardenTimeOfDay) {
  return { ...SEASON_PALETTES[season], ...DAY_PALETTES[timeOfDay] };
}

function deriveActivity(stats: GardenStats, days: GardenDay[]) {
  if (days.length > 0) {
    const recent = days.slice(-56);
    const occupied = recent.filter((day) => day.count > 0).length / recent.length;
    const intensity =
      recent.reduce((total, day) => total + clamp(day.level, 0, 4), 0) /
      (recent.length * 4);
    return clamp01(occupied * 0.62 + intensity * 0.38);
  }

  return clamp01(0.25 + Math.log10(stats.totalContributions + 1) / 4.2);
}

function mergeClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function GardenScene({
  stats,
  days = [],
  username = "gardener",
  season,
  weather,
  timeOfDay,
  visibleThrough,
  activity,
  flythrough = false,
  walkthrough = false,
  walkInput = EMPTY_WALK_INPUT,
  quality = "high",
  reducedMotion = false,
  className,
  onReady,
  onSelect,
  onFlythroughComplete,
  onWalkthroughExit,
}: GardenSceneProps) {
  const health = clamp01(activity ?? deriveActivity(stats, days));
  const seed = hashString(`${username}:contribution-garden-layout`);
  const palette = useMemo(
    () => paletteFor(season, timeOfDay),
    [season, timeOfDay],
  );
  const tier = TIER_SETTINGS[quality] ?? TIER_SETTINGS.high;
  const skyColor = worldPalette(season, timeOfDay).sky;

  return (
    <div
      className={mergeClassNames("contribution-garden", className)}
      data-contribution-garden="true"
      data-walkthrough={walkthrough ? "true" : "false"}
      role="region"
      aria-label={
        walkthrough
          ? "Interactive 3D garden walkthrough"
          : "Interactive 3D contribution garden"
      }
      style={{
        width: "100%",
        height: "100%",
        minHeight: 320,
        position: "relative",
        overflow: "hidden",
        background: skyColor,
      }}
    >
      <Canvas
        className="contribution-garden-canvas"
        data-garden-canvas="true"
        camera={{
          position: [15.4, 10.8, 18.8],
          fov: 42,
          near: 0.1,
          far: 90,
        }}
        dpr={tier.dpr}
        frameloop="always"
        gl={{
          antialias: quality !== "low",
          alpha: false,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 1;
        }}
        onPointerMissed={() => onSelect?.(null)}
        shadows={tier.shadows ? "percentage" : false}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <Suspense fallback={null}>
          <GardenReadySignal onReady={onReady} />
          <GardenCaptureBridge />
          <GardenWorld
            stats={stats}
            days={days}
            season={season}
            weather={weather}
            timeOfDay={timeOfDay}
            visibleThrough={visibleThrough}
            quality={quality}
            reducedMotion={reducedMotion}
            health={health}
            seed={seed}
            palette={palette}
            flythrough={flythrough}
            walkthrough={walkthrough}
            walkInput={walkInput}
            onSelect={onSelect}
            onFlythroughComplete={onFlythroughComplete}
            onWalkthroughExit={onWalkthroughExit}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function GardenReadySignal({ onReady }: { onReady?: () => void }) {
  const hasReported = useRef(false);

  useFrame(() => {
    if (hasReported.current) return;
    hasReported.current = true;
    onReady?.();
  });

  return null;
}

function GardenCaptureBridge() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const capture = (nativeEvent: Event) => {
      const event = nativeEvent as CustomEvent<{
        complete?: (blob: Blob | null) => void;
      }>;
      if (!event.detail?.complete) return;
      event.preventDefault();
      gl.render(scene, camera);
      gl.domElement.toBlob(event.detail.complete, "image/png");
    };

    window.addEventListener("contribution-garden:capture", capture);
    return () => {
      window.removeEventListener("contribution-garden:capture", capture);
    };
  }, [camera, gl, scene]);

  return null;
}

interface GardenWorldProps {
  stats: GardenStats;
  days: GardenDay[];
  season: GardenSeason;
  weather: GardenWeather;
  timeOfDay: GardenTimeOfDay;
  visibleThrough?: string;
  quality: GardenQuality;
  reducedMotion: boolean;
  health: number;
  seed: number;
  palette: GardenPalette;
  flythrough: boolean;
  walkthrough: boolean;
  walkInput: GardenWalkInput;
  onSelect?: (selection: GardenSelection | null) => void;
  onFlythroughComplete?: () => void;
  onWalkthroughExit?: () => void;
}

/**
 * Circles along the waterfall's outflow channel, from the pond's edge to the
 * rim point the channel pours over, so year trees keep off the water.
 */
function waterfallChannelObstacles(
  layout: GardenLayout,
  quality: GardenQuality,
  seed: number,
) {
  const pond = layout.pond;
  const rim = outflowRimPoint(layout.islandRadius, pond, quality, seed);
  const dx = rim.x - pond.x;
  const dz = rim.z - pond.z;
  const length = Math.hypot(dx, dz);
  const start = Math.min(length, 1.2 * pond.scale);
  const count = Math.max(2, Math.ceil((length - start) / 1.1) + 1);
  return Array.from({ length: count }, (_, index) => {
    const distance = start + ((length - start) * index) / (count - 1);
    return {
      x: pond.x + (dx / length) * distance,
      z: pond.z + (dz / length) * distance,
      radius: 0.8,
    };
  });
}

function GardenWorld({
  stats,
  days,
  season,
  weather,
  timeOfDay,
  visibleThrough,
  quality,
  reducedMotion,
  health,
  seed,
  palette,
  flythrough,
  walkthrough,
  walkInput,
  onSelect,
  onFlythroughComplete,
  onWalkthroughExit,
}: GardenWorldProps) {
  const tier = TIER_SETTINGS[quality] ?? TIER_SETTINGS.high;
  const density = tier.density;
  const world = useMemo(
    () => worldPalette(season, timeOfDay),
    [season, timeOfDay],
  );
  const { layout, channel } = useMemo(() => {
    const input: MappingInput = {
      days,
      visibleThrough,
      stats: {
        pullRequests: stats.pullRequests,
        issues: stats.issues,
        repositories: stats.repositories,
        streak: stats.streak,
      },
      activity: health,
      season,
      seed,
      density,
    };
    // The island radius and pond don't depend on obstacles, so a first pass
    // tells us where the waterfall channel runs; year trees then keep off it.
    const draft = computeGardenLayout(input);
    const obstacles = waterfallChannelObstacles(draft, quality, seed);
    return {
      layout: computeGardenLayout({ ...input, obstacles }),
      channel: obstacles,
    };
  }, [
    days,
    density,
    health,
    quality,
    season,
    seed,
    stats.issues,
    stats.pullRequests,
    stats.repositories,
    stats.streak,
    visibleThrough,
  ]);
  const islandRadius = layout.islandRadius;
  // Same radius and seed as the Island mesh, so everything placed with it
  // stays grounded as the island grows with the years of history.
  const surfaceSampler = useMemo(
    () =>
      createPhotorealIslandSurfaceSampler({
        radius: islandRadius,
        quality,
        seed,
      }),
    [islandRadius, quality, seed],
  );
  const flora = useFloraLayout({
    layout,
    days,
    channel,
    surfaceSampler,
    seed: seed + 233,
  });
  const clusters = useMemo(() => flowerClusters(flora.flowers), [flora.flowers]);

  return (
    <>
      <SkyAndLights
        palette={world}
        reducedMotion={reducedMotion}
        seed={seed}
        tier={tier}
        timeOfDay={timeOfDay}
        weather={weather}
      />
      {timeOfDay === "night" ? <CelestialBody color={palette.sun} /> : null}
      <Island
        palette={world}
        quality={quality}
        radius={islandRadius}
        seed={seed}
        tier={tier}
      />
      <Water
        health={health}
        layout={layout}
        palette={world}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        seed={seed}
        stats={stats}
        surfaceSampler={surfaceSampler}
        tier={tier}
        weather={weather}
        onSelect={onSelect}
      />
      <Trees
        layout={layout}
        palette={world}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        seed={seed + 401}
        stats={stats}
        surfaceSampler={surfaceSampler}
        tier={tier}
        weather={weather}
        onSelect={onSelect}
      />
      <Meadow
        days={days}
        layout={layout}
        palette={world}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        seed={seed + 101}
        stats={stats}
        surfaceSampler={surfaceSampler}
        tier={tier}
        weather={weather}
        visibleThrough={visibleThrough}
        onSelect={onSelect}
      />
      <Flora
        flora={flora}
        palette={world}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        stats={stats}
        surfaceSampler={surfaceSampler}
        tier={tier}
        weather={weather}
        onSelect={onSelect}
      />
      <Life
        flowerClusters={clusters}
        layout={layout}
        palette={world}
        reducedMotion={reducedMotion}
        seed={seed + 701}
        surfaceSampler={surfaceSampler}
        timeOfDay={timeOfDay}
      />
      <WeatherSystem
        density={density}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        seed={seed + 997}
        season={season}
        timeOfDay={timeOfDay}
        weather={weather}
      />

      {walkthrough ? (
        <GardenWalkthroughControls
          input={walkInput}
          islandRadius={islandRadius}
          onExit={onWalkthroughExit}
          surfaceSampler={surfaceSampler}
        />
      ) : flythrough ? (
        <CameraFlythrough
          reducedMotion={reducedMotion}
          onComplete={onFlythroughComplete}
        />
      ) : (
        <OrbitControls
          enableDamping
          dampingFactor={0.055}
          enablePan={false}
          maxDistance={34}
          minDistance={12}
          maxPolarAngle={Math.PI * 0.47}
          minPolarAngle={Math.PI * 0.19}
          rotateSpeed={0.55}
          target={[0, -0.18, 0]}
          zoomSpeed={0.65}
        />
      )}
    </>
  );
}

function CelestialBody({ color }: { color: string }) {
  const radius = 1.05;
  return (
    <group position={[-10, 13, -15]}>
      <mesh>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshBasicMaterial color={color} fog={false} toneMapped={false} />
      </mesh>
      <mesh scale={1.55}>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshBasicMaterial
          color={color}
          fog={false}
          opacity={0.1}
          transparent
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function WeatherSystem({
  density,
  palette,
  quality,
  reducedMotion,
  seed,
  season,
  timeOfDay,
  weather,
}: {
  density: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
  season: GardenSeason;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
}) {
  return (
    <group>
      {timeOfDay === "night" ? <StarField count={Math.round(240 * density)} seed={seed + 1} /> : null}
      {weather === "rain" ? (
        <RainStreaks
          color="#b8dce2"
          count={Math.round(420 * density)}
          reducedMotion={reducedMotion}
          seed={seed + 2}
        />
      ) : null}
      {weather === "snow" ? (
        <WeatherParticles
          color="#f3fbff"
          count={Math.round(310 * density)}
          mode="snow"
          reducedMotion={reducedMotion}
          seed={seed + 3}
        />
      ) : null}
      {weather === "wind" ? (
        <WeatherParticles
          color={season === "autumn" ? palette.flowers[1] : palette.mote}
          count={Math.round(95 * density)}
          mode="wind"
          reducedMotion={reducedMotion}
          seed={seed + 4}
        />
      ) : null}
      {season === "autumn" && (weather === "sunny" || weather === "wind") ? (
        <WeatherParticles
          color={palette.flowers[0]}
          count={Math.round(65 * density)}
          mode="leaves"
          reducedMotion={reducedMotion}
          seed={seed + 5}
        />
      ) : null}
      {quality === "low" && weather === "sunny" && timeOfDay !== "night" ? (
        <AmbientMotes color={palette.mote} count={Math.round(95 * density)} seed={seed + 6} reducedMotion={reducedMotion} />
      ) : null}
    </group>
  );
}

function RainStreaks({
  color,
  count,
  reducedMotion,
  seed,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  seed: number;
}) {
  const lines = useRef<THREE.LineSegments>(null);
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 6);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      const x = (random() - 0.5) * 20;
      const y = 0.4 + random() * 12;
      const z = (random() - 0.5) * 20;
      const length = 0.8 + random() * 0.7;
      values[offset] = x;
      values[offset + 1] = y;
      values[offset + 2] = z;
      values[offset + 3] = x + 0.08;
      values[offset + 4] = y - length;
      values[offset + 5] = z + 0.03;
    }
    return values;
  }, [count, seed]);

  useFrame((_, delta) => {
    if (!lines.current || reducedMotion) return;
    const attribute = lines.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = attribute.array as Float32Array;

    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      const speed = delta * (8.5 + (index % 7) * 0.48);
      values[offset] += delta * 0.75;
      values[offset + 1] -= speed;
      values[offset + 3] += delta * 0.75;
      values[offset + 4] -= speed;

      if (values[offset + 4] < -0.25) {
        const length = values[offset + 1] - values[offset + 4];
        const resetY = 11.5 + (index % 5) * 0.25;
        values[offset + 1] = resetY;
        values[offset + 4] = resetY - length;
      }
    }

    attribute.needsUpdate = true;
  });

  return (
    <lineSegments ref={lines} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={color}
        depthWrite={false}
        opacity={0.78}
        toneMapped={false}
        transparent
      />
    </lineSegments>
  );
}

type WeatherParticleMode = "snow" | "wind" | "leaves";

function WeatherParticles({
  color,
  count,
  mode,
  reducedMotion,
  seed,
}: {
  color: string;
  count: number;
  mode: WeatherParticleMode;
  reducedMotion: boolean;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = (random() - 0.5) * 20;
      values[index * 3 + 1] = 0.2 + random() * 12;
      values[index * 3 + 2] = (random() - 0.5) * 20;
    }
    return values;
  }, [count, seed]);

  useFrame((state, delta) => {
    if (!points.current || reducedMotion) return;
    const attribute = points.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = attribute.array as Float32Array;
    const time = state.clock.elapsedTime;

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      if (mode === "snow") {
        values[offset] += Math.sin(time * 0.5 + index) * delta * 0.25;
        values[offset + 1] -= delta * (0.44 + (index % 5) * 0.07);
        values[offset + 2] += Math.cos(time * 0.35 + index * 0.9) * delta * 0.18;
        if (values[offset + 1] < -0.2) values[offset + 1] = 11;
      } else if (mode === "wind") {
        values[offset] += delta * (2.5 + (index % 5) * 0.35);
        values[offset + 1] += Math.sin(time * 2 + index) * delta * 0.35;
        if (values[offset] > 10) values[offset] = -10;
      } else {
        values[offset] += Math.sin(time + index) * delta * 0.42;
        values[offset + 1] -= delta * (0.34 + (index % 4) * 0.06);
        values[offset + 2] += Math.cos(time * 0.6 + index) * delta * 0.25;
        if (values[offset + 1] < 0) values[offset + 1] = 9 + (index % 4);
      }
    }
    attribute.needsUpdate = true;
  });

  const size = mode === "snow" ? 0.14 : mode === "leaves" ? 0.11 : 0.075;
  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        depthWrite={false}
        opacity={0.72}
        size={size}
        sizeAttenuation
        transparent
        toneMapped={mode === "snow" ? false : undefined}
      />
    </points>
  );
}

function AmbientMotes({
  color,
  count,
  reducedMotion,
  seed,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 7.5;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = 0.35 + random() * 4.3;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, [count, seed]);

  useFrame((state) => {
    if (!points.current || reducedMotion) return;
    points.current.rotation.y = state.clock.elapsedTime * 0.018;
    points.current.position.y = Math.sin(state.clock.elapsedTime * 0.31) * 0.05;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        depthWrite={false}
        opacity={0.46}
        size={0.045}
        sizeAttenuation
        transparent
      />
    </points>
  );
}

function StarField({ count, seed }: { count: number; seed: number }) {
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 24 + random() * 11;
      const height = 8 + random() * 16;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = height;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, [count, seed]);

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#e8f4ff"
        depthWrite={false}
        fog={false}
        opacity={0.8}
        size={0.13}
        sizeAttenuation
        transparent
        toneMapped={false}
      />
    </points>
  );
}

function GardenWalkthroughControls({
  input,
  islandRadius,
  onExit,
  surfaceSampler,
}: {
  input: GardenWalkInput;
  islandRadius: number;
  onExit?: () => void;
  surfaceSampler: PhotorealIslandSurfaceSampler;
}) {
  const getThreeState = useThree((state) => state.get);
  const inputRef = useRef(input);
  const onExitRef = useRef(onExit);
  const keyState = useRef<GardenWalkInput>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
  });
  const yaw = useRef(0);
  const pitch = useRef(-0.06);
  const savedCamera = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    fov: number | null;
    zoom: number | null;
  } | null>(null);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const movement = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useLayoutEffect(() => {
    const { camera, gl } = getThreeState();
    const canvas = gl.domElement;
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const previousCursor = canvas.style.cursor;
    const previousTabIndex = canvas.getAttribute("tabindex");
    const previouslyFocused = document.activeElement;
    savedCamera.current = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: perspectiveCamera.isPerspectiveCamera ? perspectiveCamera.fov : null,
      zoom: perspectiveCamera.isPerspectiveCamera ? perspectiveCamera.zoom : null,
    };

    const eyeHeight = 1.62;
    const startGround =
      (surfaceSampler(-6, -0.86) ?? 0) + ISLAND_SURFACE_OFFSET;
    const targetGround =
      (surfaceSampler(0.1, 0.86) ?? 0) + ISLAND_SURFACE_OFFSET;
    const start = new THREE.Vector3(-6, startGround + eyeHeight, -0.86);
    const target = new THREE.Vector3(0.1, targetGround + 1.02, 0.86);
    const direction = target.clone().sub(start).normalize();
    yaw.current = Math.atan2(-direction.x, -direction.z);
    pitch.current = Math.asin(direction.y);
    camera.position.copy(start);
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
    if (perspectiveCamera.isPerspectiveCamera) {
      perspectiveCamera.fov = 58;
      perspectiveCamera.zoom = 1;
      perspectiveCamera.updateProjectionMatrix();
    }
    canvas.setAttribute("tabindex", "0");
    canvas.focus({ preventScroll: true });
    canvas.style.setProperty("cursor", "grab");

    const setKey = (code: string, pressed: boolean) => {
      switch (code) {
        case "KeyW":
        case "ArrowUp":
          keyState.current.forward = pressed;
          return true;
        case "KeyS":
        case "ArrowDown":
          keyState.current.backward = pressed;
          return true;
        case "KeyA":
        case "ArrowLeft":
          keyState.current.left = pressed;
          return true;
        case "KeyD":
        case "ArrowRight":
          keyState.current.right = pressed;
          return true;
        case "ShiftLeft":
        case "ShiftRight":
          keyState.current.sprint = pressed;
          return true;
        default:
          return false;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        onExitRef.current?.();
        return;
      }
      const targetElement = event.target;
      if (
        targetElement instanceof HTMLElement &&
        (targetElement.matches("input, textarea, select, button") ||
          targetElement.isContentEditable)
      ) {
        return;
      }
      if (setKey(event.code, true)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (setKey(event.code, false)) event.preventDefault();
    };
    const resetKeys = () => {
      keyState.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        sprint: false,
      };
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") resetKeys();
    };

    let dragging = false;
    let activePointer = -1;
    let previousX = 0;
    let previousY = 0;
    let dragDistance = 0;
    let suppressingClick = false;

    const swallowClick = (event: MouseEvent) => {
      suppressingClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const stopDragging = (event?: PointerEvent) => {
      if (event && activePointer !== event.pointerId) return;
      const shouldSuppressClick =
        event?.type === "pointerup" && dragDistance >= 6;
      dragging = false;
      if (
        event &&
        canvas.hasPointerCapture(event.pointerId)
      ) {
        canvas.releasePointerCapture(event.pointerId);
      }
      activePointer = -1;
      canvas.style.setProperty("cursor", "grab");
      if (shouldSuppressClick && !suppressingClick) {
        suppressingClick = true;
        canvas.addEventListener("click", swallowClick, {
          capture: true,
          once: true,
        });
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || dragging) return;
      event.preventDefault();
      dragging = true;
      activePointer = event.pointerId;
      previousX = event.clientX;
      previousY = event.clientY;
      dragDistance = 0;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.setProperty("cursor", "grabbing");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== activePointer) return;
      const deltaX = event.clientX - previousX;
      const deltaY = event.clientY - previousY;
      previousX = event.clientX;
      previousY = event.clientY;
      dragDistance += Math.hypot(deltaX, deltaY);
      const sensitivity = event.pointerType === "touch" ? 0.006 : 0.00235;
      yaw.current -= deltaX * sensitivity;
      pitch.current = clamp(
        pitch.current - deltaY * sensitivity,
        -Math.PI * (5 / 12),
        Math.PI * (5 / 12),
      );
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    window.addEventListener("blur", resetKeys);
    document.addEventListener("visibilitychange", onVisibilityChange);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopDragging);
    canvas.addEventListener("pointercancel", stopDragging);
    canvas.addEventListener("lostpointercapture", stopDragging);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetKeys);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopDragging);
      canvas.removeEventListener("pointercancel", stopDragging);
      canvas.removeEventListener("lostpointercapture", stopDragging);
      if (suppressingClick) {
        canvas.removeEventListener("click", swallowClick, true);
      }
      if (
        activePointer >= 0 &&
        canvas.hasPointerCapture(activePointer)
      ) {
        canvas.releasePointerCapture(activePointer);
      }
      resetKeys();
      canvas.style.setProperty("cursor", previousCursor);
      if (previousTabIndex === null) {
        canvas.removeAttribute("tabindex");
      } else {
        canvas.setAttribute("tabindex", previousTabIndex);
      }

      const saved = savedCamera.current;
      if (saved) {
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        if (perspectiveCamera.isPerspectiveCamera && saved.fov !== null) {
          perspectiveCamera.fov = saved.fov;
          if (saved.zoom !== null) perspectiveCamera.zoom = saved.zoom;
          perspectiveCamera.updateProjectionMatrix();
        }
      }
      savedCamera.current = null;
      window.requestAnimationFrame(() => {
        if (
          previouslyFocused instanceof HTMLElement &&
          previouslyFocused.isConnected
        ) {
          previouslyFocused.focus({ preventScroll: true });
        }
      });
    };
  }, [getThreeState, surfaceSampler]);

  useFrame((state, delta) => {
    const camera = state.camera;
    const keyboard = keyState.current;
    const touch = inputRef.current;
    const forwardAmount =
      Number(keyboard.forward || touch.forward) -
      Number(keyboard.backward || touch.backward);
    const rightAmount =
      Number(keyboard.right || touch.right) -
      Number(keyboard.left || touch.left);
    const moving = forwardAmount !== 0 || rightAmount !== 0;

    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
    if (moving) {
      forward.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      right.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
      movement
        .set(0, 0, 0)
        .addScaledVector(forward, forwardAmount)
        .addScaledVector(right, rightAmount)
        .normalize();

      const sprinting = Boolean(keyboard.sprint || touch.sprint);
      const speed = sprinting ? 3.35 : 1.9;
      const distance = speed * Math.min(delta, 0.05);
      const currentGround =
        (surfaceSampler(camera.position.x, camera.position.z) ?? 0) +
        ISLAND_SURFACE_OFFSET;
      const isWalkable = (x: number, z: number) => {
        const sampledHeight = surfaceSampler(x, z);
        return (
          sampledHeight !== null &&
          Math.hypot(x, z) <= islandRadius - 0.72 &&
          isOutsideMeadowPond(x, z, WALK_POND, 1.28) &&
          Math.hypot(x - 2.62, z - 0.48) > 1.24 &&
          Math.abs(sampledHeight + ISLAND_SURFACE_OFFSET - currentGround) < 0.46
        );
      };

      const nextX = camera.position.x + movement.x * distance;
      let resolvedX = camera.position.x;
      if (isWalkable(nextX, camera.position.z)) {
        resolvedX = nextX;
      }
      const nextZ = camera.position.z + movement.z * distance;
      let resolvedZ = camera.position.z;
      if (isWalkable(resolvedX, nextZ)) {
        resolvedZ = nextZ;
      }
      camera.position.x = resolvedX;
      camera.position.z = resolvedZ;
    }
    const terrainHeight =
      (surfaceSampler(camera.position.x, camera.position.z) ?? 0) +
      ISLAND_SURFACE_OFFSET;
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      terrainHeight + 1.62,
      13,
      Math.min(delta, 0.05),
    );
  });

  return null;
}

function CameraFlythrough({
  reducedMotion,
  onComplete,
}: {
  reducedMotion: boolean;
  onComplete?: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const elapsed = useRef(0);
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const path = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(14.8, 12.8, 17.2),
          new THREE.Vector3(7.6, 8.5, 14.2),
          new THREE.Vector3(-7.2, 7.4, 12.8),
          new THREE.Vector3(-14.3, 7.8, -2.8),
          new THREE.Vector3(-5.3, 7.2, -13.6),
          new THREE.Vector3(9.8, 8, -10.8),
          new THREE.Vector3(14.8, 12.8, 17.2),
        ],
        false,
        "catmullrom",
        0.42,
      ),
    [],
  );
  const position = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    elapsed.current = 0;
    completed.current = false;
    if (reducedMotion) {
      completed.current = true;
      onCompleteRef.current?.();
    }
  }, [reducedMotion]);

  useFrame((state, delta) => {
    if (reducedMotion || completed.current) return;
    elapsed.current += delta;
    const progress = clamp01(elapsed.current / 16);
    const eased = progress * progress * (3 - 2 * progress);
    path.getPointAt(eased, position);
    camera.position.lerp(position, 1 - Math.exp(-delta * 5.5));
    target.set(
      Math.sin(eased * Math.PI * 2) * 1.3,
      1 + Math.sin(eased * Math.PI) * 0.58,
      Math.cos(eased * Math.PI * 2) * 0.85,
    );
    camera.lookAt(target);

    if (progress >= 1) {
      completed.current = true;
      path.getPointAt(1, position);
      camera.position.copy(position);
      camera.lookAt(target);
      onCompleteRef.current?.();
    }
  });

  return null;
}
