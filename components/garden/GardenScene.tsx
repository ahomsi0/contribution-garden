"use client";

import {
  Suspense,
  type ComponentRef,
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
  createPhotorealIslandEdge,
  createPhotorealIslandSurfaceSampler,
  type PhotorealIslandSurfaceSampler,
} from "./photoreal-geometry";
import {
  cameraFraming,
  CAMERA_FOV,
  type CameraFraming,
  type FramingPeak,
  GREAT_TREE_TOP,
  REFERENCE_DISTANCE,
  sameFraming,
  YEAR_CROWN_RADIUS,
  YEAR_TREE_TOP,
} from "./world/camera";
import { Effects, SCENE_COMPOSER_KEY } from "./world/Effects";
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
import { type WorldPalette, worldPalette } from "./world/palette";
import { SkyAndLights } from "./world/Sky";
import { TIER_SETTINGS } from "./world/tiers";
import { Trees } from "./world/Trees";
import { outflowRimPoint, Water } from "./world/Water";

/** How long the orbit camera takes to ease to a new framing, seconds. */
const REFRAME_SECONDS = 0.8;
const EMPTY_WALK_INPUT: GardenWalkInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
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
  const tier = TIER_SETTINGS[quality] ?? TIER_SETTINGS.high;
  // Shown until the canvas draws: the middle of the sky gradient.
  const skyColor = worldPalette(season, timeOfDay).skyMid;

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
          fov: CAMERA_FOV,
          near: 0.1,
          far: 160,
        }}
        dpr={tier.dpr}
        frameloop="always"
        gl={{
          // Low stays cheap; medium and high draw through the effect
          // composer, which anti-aliases with FXAA, so a multisampled canvas
          // would only add a full-screen resolve on top.
          antialias: false,
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
      const composer = scene.userData[SCENE_COMPOSER_KEY] as
        | { render: (deltaTime?: number) => void }
        | undefined;
      if (composer) {
        // The canvas has no multisampling of its own while a composer is
        // mounted, so the portrait goes through it for FXAA and the effects.
        composer.render(0);
      } else {
        gl.render(scene, camera);
      }
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

  // The channel's last circle sits on the rim point the waterfall pours over.
  const waterfall = channel[channel.length - 1];
  const islandEdge = useMemo(
    () => createPhotorealIslandEdge({ radius: islandRadius, quality, seed }),
    [islandRadius, quality, seed],
  );
  const aspect = useThree(
    (state) =>
      Math.round((state.size.width / Math.max(1, state.size.height)) * 20) / 20,
  );
  const framing = useMemo(() => {
    const groundAt = (x: number, z: number) =>
      (surfaceSampler(x, z) ?? 0) + ISLAND_SURFACE_OFFSET;
    const great = layout.greatTree;
    const peaks: FramingPeak[] = layout.yearTrees.map((tree) => ({
      x: tree.x,
      z: tree.z,
      top: groundAt(tree.x, tree.z) + YEAR_TREE_TOP * tree.scale,
      crownRadius: YEAR_CROWN_RADIUS * tree.scale,
    }));
    return cameraFraming(
      layout.islandRadius,
      groundAt(great.x, great.z) + GREAT_TREE_TOP * great.scale,
      Math.atan2(waterfall.z, waterfall.x),
      { aspect, greatTree: great, peaks, rimRadiusAt: islandEdge.rimRadiusAt },
    );
  }, [aspect, islandEdge, layout, surfaceSampler, waterfall]);
  const orbiting = !walkthrough && !flythrough;

  return (
    <>
      <SkyAndLights
        fogScale={clamp(framing.distance / REFERENCE_DISTANCE, 0.9, 2.2)}
        islandRadius={islandRadius}
        palette={world}
        viewAzimuth={framing.azimuth}
        reducedMotion={reducedMotion}
        seed={seed}
        tier={tier}
        timeOfDay={timeOfDay}
        weather={weather}
      />
      {timeOfDay === "night" ? <CelestialBody color={world.sun} /> : null}
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
        palette={world}
        quality={quality}
        reducedMotion={reducedMotion}
        seed={seed + 997}
        season={season}
        timeOfDay={timeOfDay}
        weather={weather}
      />

      <Effects tier={tier} />

      {walkthrough ? (
        <GardenWalkthroughControls
          input={walkInput}
          layout={layout}
          onExit={onWalkthroughExit}
          surfaceSampler={surfaceSampler}
        />
      ) : flythrough ? (
        <CameraFlythrough
          framing={framing}
          islandRadius={islandRadius}
          reducedMotion={reducedMotion}
          waterfall={waterfall}
          onComplete={onFlythroughComplete}
        />
      ) : null}
      <OrbitRig
        enabled={orbiting}
        framing={framing}
        reducedMotion={reducedMotion}
      />
    </>
  );
}

interface FramingTween {
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  from: THREE.Spherical;
  to: THREE.Spherical;
  elapsed: number;
}

/**
 * The orbit camera. It starts at the framing for this island and, when the
 * framing changes (another user, or the timeline growing the island), eases
 * there over REFRAME_SECONDS instead of jumping. Once the user has orbited or
 * zoomed, a re-frame keeps their viewing direction and only rescales the
 * distance and moves the target. Grabbing the controls cancels an ease.
 */
function OrbitRig({
  enabled,
  framing,
  reducedMotion,
}: {
  enabled: boolean;
  framing: CameraFraming;
  reducedMotion: boolean;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);
  const framed = useRef<CameraFraming | null>(null);
  const stale = useRef(false);
  const userMoved = useRef(false);
  const tween = useRef<FramingTween | null>(null);
  const scratch = useMemo(
    () => ({ spherical: new THREE.Spherical(), offset: new THREE.Vector3() }),
    [],
  );

  const applyTween = (active: FramingTween, amount: number) => {
    const orbit = controls.current;
    if (!orbit) return;
    const { from, to } = active;
    const turn =
      THREE.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) -
      Math.PI;
    scratch.spherical.set(
      THREE.MathUtils.lerp(from.radius, to.radius, amount),
      THREE.MathUtils.lerp(from.phi, to.phi, amount),
      from.theta + turn * amount,
    );
    orbit.target.lerpVectors(active.fromTarget, active.toTarget, amount);
    scratch.offset.setFromSpherical(scratch.spherical);
    camera.position.copy(orbit.target).add(scratch.offset);
    camera.lookAt(orbit.target);
  };

  const finishTween = () => {
    const orbit = controls.current;
    tween.current = null;
    if (!orbit || !framed.current) return;
    orbit.minDistance = framed.current.minDistance;
    orbit.maxDistance = framed.current.maxDistance;
  };

  useLayoutEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const previous = framed.current;

    if (!previous) {
      // First framing: place the camera directly.
      framed.current = framing;
      camera.position.set(...framing.position);
      orbit.target.set(...framing.target);
      orbit.minDistance = framing.minDistance;
      orbit.maxDistance = framing.maxDistance;
      camera.lookAt(orbit.target);
      orbit.update();
      stale.current = !enabled;
      return;
    }
    if (!enabled) {
      // A flythrough or walk owns the camera; ease back to the framing from
      // wherever it leaves the camera once orbiting resumes.
      finishTween();
      stale.current = true;
      return;
    }
    if (!stale.current && sameFraming(previous, framing)) return;
    stale.current = false;
    framed.current = framing;

    const toTarget = new THREE.Vector3(...framing.target);
    const from = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(orbit.target),
    );
    let to: THREE.Spherical;
    if (userMoved.current) {
      to = from.clone();
      to.radius = clamp(
        (from.radius * framing.distance) / previous.distance,
        framing.minDistance,
        framing.maxDistance,
      );
    } else {
      to = new THREE.Spherical().setFromVector3(
        new THREE.Vector3(...framing.position).sub(toTarget),
      );
    }
    const next: FramingTween = {
      fromTarget: orbit.target.clone(),
      toTarget,
      from,
      to,
      elapsed: 0,
    };
    if (reducedMotion) {
      applyTween(next, 1);
      finishTween();
      orbit.update();
      return;
    }
    // Open the zoom limits while easing so the controls never clamp mid-way.
    orbit.minDistance = 0;
    orbit.maxDistance = Infinity;
    tween.current = next;
    // applyTween and finishTween only touch refs; they need not be deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, enabled, framing, reducedMotion]);

  useFrame((_, delta) => {
    const active = tween.current;
    if (!active || !enabled) return;
    active.elapsed += Math.min(delta, 0.1);
    const progress = clamp01(active.elapsed / REFRAME_SECONDS);
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    applyTween(active, eased);
    if (progress >= 1) finishTween();
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={enabled}
      enableDamping
      dampingFactor={0.055}
      enablePan={false}
      maxPolarAngle={Math.PI * 0.47}
      minPolarAngle={Math.PI * 0.19}
      rotateSpeed={0.55}
      zoomSpeed={0.65}
      onStart={() => {
        userMoved.current = true;
        if (tween.current) finishTween();
      }}
    />
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
  palette: WorldPalette;
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
          color={season === "autumn" ? palette.flowers[1] : palette.sun}
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
        <AmbientMotes color={palette.sun} count={Math.round(95 * density)} seed={seed + 6} reducedMotion={reducedMotion} />
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
  layout,
  onExit,
  surfaceSampler,
}: {
  input: GardenWalkInput;
  layout: GardenLayout;
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
  // Trunks to walk around: every year tree and the great tree.
  const obstacles = useMemo(
    () => [
      ...layout.yearTrees.map((tree) => ({
        x: tree.x,
        z: tree.z,
        radius: 0.45 * tree.scale,
      })),
      {
        x: layout.greatTree.x,
        z: layout.greatTree.z,
        radius: 1.0 * layout.greatTree.scale,
      },
    ],
    [layout.greatTree, layout.yearTrees],
  );
  const walkRadius = layout.islandRadius - 0.7;
  const pond = layout.pond;

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
      const fromX = camera.position.x;
      const fromZ = camera.position.z;
      // A step into a trunk is blocked; a step that leaves one never is, so
      // the walker can't get stuck.
      const hitsTrunk = (x: number, z: number) =>
        obstacles.some((obstacle) => {
          const distance = Math.hypot(x - obstacle.x, z - obstacle.z);
          return (
            distance < obstacle.radius &&
            distance < Math.hypot(fromX - obstacle.x, fromZ - obstacle.z)
          );
        });
      const isWalkable = (x: number, z: number) => {
        const sampledHeight = surfaceSampler(x, z);
        return (
          sampledHeight !== null &&
          Math.hypot(x, z) <= walkRadius &&
          isOutsideMeadowPond(x, z, pond, 1.28) &&
          !hitsTrunk(x, z) &&
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

/** The flythrough loop for a radius-11.5 island; it scales with the island. */
const FLYTHROUGH_PATH: ReadonlyArray<[number, number, number]> = [
  [14.8, 12.8, 17.2],
  [7.6, 8.5, 14.2],
  [-7.2, 7.4, 12.8],
  [-14.3, 7.8, -2.8],
  [-5.3, 7.2, -13.6],
  [9.8, 8, -10.8],
  [14.8, 12.8, 17.2],
];
const FLYTHROUGH_RADIUS = 11.5;
const FLYTHROUGH_START_AZIMUTH = Math.atan2(17.2, 14.8);
/** Height on the cliff the opening shot looks at: the middle of the fall. */
const WATERFALL_LOOK_Y = -1.6;

function CameraFlythrough({
  framing,
  islandRadius,
  reducedMotion,
  waterfall,
  onComplete,
}: {
  framing: CameraFraming;
  islandRadius: number;
  reducedMotion: boolean;
  waterfall: { x: number; z: number };
  onComplete?: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const elapsed = useRef(0);
  const completed = useRef(false);
  const lookReady = useRef(false);
  const onCompleteRef = useRef(onComplete);
  // The loop turns to start (and end) on the orbit framing's side of the
  // island, which faces the waterfall, and scales with the island. Orbiting
  // eases back to the framing once the flight ends.
  const turn = framing.azimuth - FLYTHROUGH_START_AZIMUTH;
  const path = useMemo(() => {
    const scale = islandRadius / FLYTHROUGH_RADIUS;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const points = FLYTHROUGH_PATH.map(
      ([x, y, z]) =>
        new THREE.Vector3(
          (x * cos - z * sin) * scale,
          y * scale,
          (x * sin + z * cos) * scale,
        ),
    );
    return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.42);
  }, [islandRadius, turn]);
  const position = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const waterfallPoint = useMemo(
    () => new THREE.Vector3(waterfall.x, WATERFALL_LOOK_Y, waterfall.z),
    [waterfall.x, waterfall.z],
  );
  const finalTarget = useMemo(
    () => new THREE.Vector3(...framing.target),
    [framing.target],
  );

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
    if (!lookReady.current) {
      // Start from wherever the camera is looking, then pan to the fall.
      lookReady.current = true;
      camera.getWorldDirection(look);
      look
        .multiplyScalar(camera.position.distanceTo(finalTarget))
        .add(camera.position);
    }
    elapsed.current += delta;
    const progress = clamp01(elapsed.current / 16);
    const eased = progress * progress * (3 - 2 * progress);
    path.getPointAt(eased, position);
    camera.position.lerp(position, 1 - Math.exp(-delta * 5.5));
    const swirlX = Math.sin(eased * Math.PI * 2) * 1.3;
    const swirlZ = Math.cos(eased * Math.PI * 2) * 0.85;
    target.set(
      swirlX * Math.cos(turn) - swirlZ * Math.sin(turn),
      1 + Math.sin(eased * Math.PI) * 0.58,
      swirlX * Math.sin(turn) + swirlZ * Math.cos(turn),
    );
    // Open on the waterfall, settle on the orbit target at the end.
    target.lerp(waterfallPoint, 1 - THREE.MathUtils.smoothstep(eased, 0.06, 0.24));
    target.lerp(finalTarget, THREE.MathUtils.smoothstep(eased, 0.8, 1));
    look.lerp(target, 1 - Math.exp(-delta * 3.5));
    camera.lookAt(look);

    if (progress >= 1) {
      completed.current = true;
      camera.position.copy(path.getPointAt(1, position));
      camera.lookAt(finalTarget);
      onCompleteRef.current?.();
    }
  });

  return null;
}
