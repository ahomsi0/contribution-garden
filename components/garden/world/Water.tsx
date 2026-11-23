"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  createPhotorealIslandEdge,
  type PhotorealIslandEdge,
  type PhotorealIslandSurfaceSampler,
} from "../photoreal-geometry";
import type {
  GardenQuality,
  GardenSeason,
  GardenSelection,
  GardenStats,
  GardenWeather,
} from "../types";
import { ISLAND_SURFACE_OFFSET } from "./Island";
import type { WorldPalette } from "./palette";
import type { TierSettings } from "./tiers";

export interface WaterProps {
  /**
   * The island and pond as primitives, so the water only rebuilds when one
   * of them actually changes, not whenever a new layout object arrives.
   */
  islandRadius: number;
  pondX: number;
  pondZ: number;
  pondScale: number;
  palette: WorldPalette;
  tier: TierSettings;
  /** Island mesh resolution; the waterfall follows the same cliff vertices. */
  quality: GardenQuality;
  /** The island seed (the same one the Island mesh uses). */
  seed: number;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  season: GardenSeason;
  weather: GardenWeather;
  reducedMotion: boolean;
  onSelect?: (selection: GardenSelection | null) => void;
  stats: GardenStats;
  health: number;
}

/** Today's pond semi-axes before the layout's repository-driven scale. */
const POND_SEMI_X = 1.96;
const POND_SEMI_Z = 1.2;
const CHANNEL_WIDTH = 0.35;
const STREAM_WIDTH = 0.5;
const STREAM_DROP = 4.5;
const TAU = Math.PI * 2;
const MIST_LIP = 10;
const MIST_BASE = 20;

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

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function useCursorHandlers() {
  return useMemo(
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
}

function createOrganicPondGeometry(seed: number, segments: number, radius = 1) {
  const geometry = new THREE.CircleGeometry(radius, segments);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uvs = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const random = seededRandom(seed);
  const phaseA = random() * TAU;
  const phaseB = random() * TAU;
  const phaseC = random() * TAU;

  for (let index = 1; index < positions.count; index += 1) {
    const angle = Math.atan2(positions.getY(index), positions.getX(index));
    const edgeVariation =
      Math.sin(angle * 3 + phaseA) * 0.035 +
      Math.sin(angle * 5 + phaseB) * 0.022 +
      Math.sin(angle * 9 + phaseC) * 0.012;
    const edgeRadius = radius * (1 + edgeVariation);
    positions.setXY(index, Math.cos(angle) * edgeRadius, Math.sin(angle) * edgeRadius);
    uvs.setXY(
      index,
      0.5 + (Math.cos(angle) * edgeRadius) / (radius * 2.16),
      0.5 + (Math.sin(angle) * edgeRadius) / (radius * 2.16),
    );
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A tiling normal map of three crossing wave trains. */
function createWaterNormalTexture(seed: number, resolution: number) {
  const data = new Uint8Array(resolution * resolution * 4);
  const random = seededRandom(seed);
  const phaseA = random() * TAU;
  const phaseB = random() * TAU;
  const phaseC = random() * TAU;
  const normal = new THREE.Vector3();

  for (let y = 0; y < resolution; y += 1) {
    const v = y / resolution;
    for (let x = 0; x < resolution; x += 1) {
      const u = x / resolution;
      const waveA = TAU * (u * 3 + v * 2) + phaseA;
      const waveB = TAU * (u * -2 + v * 5) + phaseB;
      const waveC = TAU * (u * 7 - v * 3) + phaseC;
      const slopeX =
        Math.cos(waveA) * 0.54 + Math.cos(waveB) * -0.24 + Math.cos(waveC) * 0.13;
      const slopeY =
        Math.cos(waveA) * 0.36 + Math.cos(waveB) * 0.6 + Math.cos(waveC) * -0.055;
      normal.set(-slopeX * 0.16, -slopeY * 0.16, 1).normalize();

      const offset = (y * resolution + x) * 4;
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.35, 1.7);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Vertical streaks for running water. Used as both the colour map and the
 * alpha map (green channel), so bright streaks are also the opaque ones.
 */
function createStreakTexture(seed: number) {
  const width = 32;
  const height = 128;
  const data = new Uint8Array(width * height * 4);
  const random = seededRandom(seed);
  const controls = 8;
  const amplitude = Array.from({ length: controls }, () => 0.35 + random() * 0.65);
  const phase = Array.from({ length: controls }, () => random() * TAU);
  const frequency = Array.from({ length: controls }, () => 1 + Math.floor(random() * 2));

  for (let x = 0; x < width; x += 1) {
    // Columns blend between periodic control points so the texture tiles in u.
    const position = (x / width) * controls;
    const left = Math.floor(position) % controls;
    const right = (left + 1) % controls;
    const blend = smoothstep(0, 1, position - Math.floor(position));
    const columnAmplitude = amplitude[left] + (amplitude[right] - amplitude[left]) * blend;
    for (let y = 0; y < height; y += 1) {
      const v = y / height;
      const wave =
        0.5 +
        0.32 * Math.sin(TAU * v * frequency[left] + phase[left]) * (1 - blend) +
        0.32 * Math.sin(TAU * v * frequency[right] + phase[right]) * blend +
        0.1 * Math.sin(TAU * v * 3 + phase[(left + 3) % controls]);
      const value = 0.58 + 0.42 * Math.min(1, Math.max(0, wave * columnAmplitude + (1 - columnAmplitude) * 0.55));
      const byte = Math.round(value * 255);
      const offset = (y * width + x) * 4;
      data[offset] = byte;
      data[offset + 1] = byte;
      data[offset + 2] = byte;
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** A soft round puff for mist points. */
function createPuffTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const falloff = Math.max(0, 1 - (dx * dx + dy * dy) * 4);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(falloff * falloff * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A thin tapered blade, base at the origin, one unit tall. */
function createReedGeometry() {
  const geometry = new THREE.BufferGeometry();
  const rows = 4;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const half = 0.035 * (1 - t) + 0.002;
    const lean = t * t * 0.12;
    positions.push(-half + lean, t, 0, half + lean, t, 0);
    if (row < rows) {
      const a = row * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A lily pad: a disc with a notch, lying flat. */
function createLilyPadGeometry() {
  const geometry = new THREE.CircleGeometry(1, 18, 0.32, TAU - 0.64);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

interface PondFrame {
  /** World-space water level. */
  surfaceY: number;
  semiX: number;
  semiZ: number;
  /**
   * Distance from the pond centre to the visible shore (where the terrain
   * rises above the water) for evenly spaced headings.
   */
  shore: Float32Array;
  shoreAt: (heading: number) => number;
  /** Ground height relative to the water level, in pond-local x/z. */
  groundAt: (localX: number, localZ: number) => number;
}

function createPondFrame(
  cx: number,
  cz: number,
  scale: number,
  sampler: PhotorealIslandSurfaceSampler,
): PondFrame {
  const semiX = POND_SEMI_X * scale;
  const semiZ = POND_SEMI_Z * scale;
  const surfaceY =
    (sampler(cx, cz) ?? 0) + ISLAND_SURFACE_OFFSET + 0.2 + (scale - 1) * 0.1;
  const samples = 48;
  const shore = new Float32Array(samples);

  for (let index = 0; index < samples; index += 1) {
    const heading = (index / samples) * TAU;
    const dx = Math.cos(heading);
    const dz = Math.sin(heading);
    // The water mesh's own edge in this heading.
    const limit =
      1 / Math.sqrt((dx / semiX) * (dx / semiX) + (dz / semiZ) * (dz / semiZ));
    let distance = limit;
    for (let step = 0.1; step <= limit; step += 0.05) {
      const ground = sampler(cx + dx * step, cz + dz * step);
      if (ground === null || ground + ISLAND_SURFACE_OFFSET > surfaceY - 0.005) {
        distance = Math.max(0.3, step - 0.025);
        break;
      }
    }
    shore[index] = distance;
  }

  const shoreAt = (heading: number) => {
    const position = (((heading % TAU) + TAU) % TAU) / TAU * samples;
    const left = Math.floor(position) % samples;
    const right = (left + 1) % samples;
    const blend = position - Math.floor(position);
    return shore[left] + (shore[right] - shore[left]) * blend;
  };

  const groundAt = (localX: number, localZ: number) => {
    const ground = sampler(cx + localX, cz + localZ);
    return ground === null ? 0 : ground + ISLAND_SURFACE_OFFSET - surfaceY;
  };

  return { surfaceY, semiX, semiZ, shore, shoreAt, groundAt };
}

export function Water({
  islandRadius,
  pondX,
  pondZ,
  pondScale,
  palette,
  tier,
  quality,
  seed,
  surfaceSampler,
  season,
  weather,
  reducedMotion,
  onSelect,
  stats,
  health,
}: WaterProps) {
  const frozen = season === "winter";
  const pond = useMemo(
    () => createPondFrame(pondX, pondZ, pondScale, surfaceSampler),
    [pondScale, pondX, pondZ, surfaceSampler],
  );

  return (
    <group name="water">
      <Pond
        frame={pond}
        frozen={frozen}
        health={health}
        palette={palette}
        pondX={pondX}
        pondZ={pondZ}
        quality={quality}
        reducedMotion={reducedMotion}
        seed={seed + 83}
        stats={stats}
        tier={tier}
        weather={weather}
        onSelect={onSelect}
      />
      <Waterfall
        frame={pond}
        frozen={frozen}
        islandRadius={islandRadius}
        palette={palette}
        pondX={pondX}
        pondZ={pondZ}
        quality={quality}
        reducedMotion={reducedMotion}
        seed={seed}
        surfaceSampler={surfaceSampler}
        tier={tier}
        weather={weather}
      />
    </group>
  );
}

function Pond({
  frame,
  frozen,
  health,
  palette,
  pondX,
  pondZ,
  quality,
  reducedMotion,
  seed,
  stats,
  tier,
  weather,
  onSelect,
}: {
  frame: PondFrame;
  frozen: boolean;
  health: number;
  palette: WorldPalette;
  pondX: number;
  pondZ: number;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
  stats: GardenStats;
  tier: TierSettings;
  weather: GardenWeather;
  onSelect?: (selection: GardenSelection | null) => void;
}) {
  const water = useRef<THREE.Mesh>(null);
  const rippleOne = useRef<THREE.Mesh>(null);
  const rippleTwo = useRef<THREE.Mesh>(null);
  const fish = useRef<THREE.Group>(null);
  const segments = quality === "high" ? 96 : quality === "medium" ? 64 : 40;
  const waterGeometry = useMemo(
    () => createOrganicPondGeometry(seed + 17, segments),
    [seed, segments],
  );
  const bedGeometry = useMemo(
    () => createOrganicPondGeometry(seed + 31, segments, 1.08),
    [seed, segments],
  );
  const normalMap = useMemo(
    () =>
      createWaterNormalTexture(
        seed + 47,
        quality === "high" ? 128 : quality === "medium" ? 96 : 64,
      ),
    [quality, seed],
  );
  const normalScale = useMemo(() => new THREE.Vector2(0.3, 0.3), []);
  // A soft glow band just inside the visible shore line.
  const glowGeometry = useMemo(() => {
    const samples = frame.shore.length;
    const positions = new Float32Array((samples + 1) * 2 * 3);
    const colors = new Float32Array((samples + 1) * 2 * 4);
    const indices: number[] = [];
    for (let index = 0; index <= samples; index += 1) {
      const heading = (index / samples) * TAU;
      const shore = frame.shore[index % samples];
      const dx = Math.cos(heading);
      const dz = Math.sin(heading);
      const inner = Math.max(0.2, shore - 0.16);
      const outer = shore + 0.02;
      positions.set([dx * inner, 0, dz * inner, dx * outer, 0, dz * outer], index * 6);
      colors.set([1, 1, 1, 0, 1, 1, 1, 0.7], index * 8);
      if (index < samples) {
        const a = index * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    return geometry;
  }, [frame]);
  const cursorHandlers = useCursorHandlers();
  const frozenColor = useMemo(
    () =>
      `#${new THREE.Color(palette.water)
        .lerp(new THREE.Color(palette.snow ?? "#eef3f5"), 0.6)
        .getHexString()}`,
    [palette.snow, palette.water],
  );

  useEffect(
    () => () => {
      waterGeometry.dispose();
      bedGeometry.dispose();
      normalMap.dispose();
      glowGeometry.dispose();
    },
    [bedGeometry, glowGeometry, normalMap, waterGeometry],
  );

  useFrame((state) => {
    if (reducedMotion || frozen) return;
    const time = state.clock.elapsedTime;
    const material = water.current?.material as THREE.MeshStandardMaterial | undefined;
    if (material?.normalMap) {
      const speed = weather === "wind" ? 0.018 : weather === "rain" ? 0.012 : 0.006;
      material.normalMap.offset.set((time * speed) % 1, (time * speed * 0.63) % 1);
    }
    if (rippleOne.current) {
      const phase = (time * 0.17) % 1;
      rippleOne.current.scale.setScalar(0.65 + phase * 0.8);
      (rippleOne.current.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.22;
    }
    if (rippleTwo.current) {
      const phase = (time * 0.14 + 0.52) % 1;
      rippleTwo.current.scale.setScalar(0.55 + phase * 0.65);
      (rippleTwo.current.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.18;
    }
    if (fish.current) fish.current.rotation.y = time * 0.24;
  });

  const selectWater = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.({
      kind: "water",
      id: "activity-pond",
      title: frozen ? "Frozen activity pond" : "Activity pond",
      subtitle: "Recent activity",
      description:
        health > 0.62
          ? "Recent momentum keeps the garden water bright and clear."
          : "The pond grows quieter during slower contribution seasons.",
      accent: palette.waterGlow,
      worldPosition: [pondX, frame.surfaceY + 0.08, pondZ],
      count: stats.totalContributions,
      details: [
        { label: "Garden health", value: `${Math.round(health * 100)}%` },
        { label: "Contributions", value: stats.totalContributions.toLocaleString() },
        { label: "Repositories", value: stats.repositories },
      ],
    });
  };

  const fishRadius = Math.min(frame.semiX, frame.semiZ * 1.4) * 0.36;

  return (
    <group name="pond" position={[pondX, frame.surfaceY, pondZ]}>
      <mesh
        geometry={bedGeometry}
        position={[0, -0.13, 0]}
        receiveShadow={tier.shadows}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[frame.semiX * 1.06, frame.semiZ * 1.12, 1]}
      >
        <meshStandardMaterial
          color={palette.waterDeep}
          polygonOffset
          polygonOffsetFactor={1}
          roughness={1}
        />
      </mesh>
      <mesh
        ref={water}
        geometry={waterGeometry}
        position={[0, 0.012, 0]}
        receiveShadow={tier.shadows}
        renderOrder={2}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[frame.semiX, frame.semiZ, 1]}
        onClick={selectWater}
        {...cursorHandlers}
      >
        <meshStandardMaterial
          key={frozen ? "ice" : "water"}
          color={frozen ? frozenColor : palette.water}
          depthWrite={false}
          metalness={0.05}
          normalMap={frozen ? null : normalMap}
          normalScale={normalScale}
          opacity={frozen ? 0.96 : 0.92}
          roughness={frozen ? 0.4 : 0.15}
          transparent
        />
      </mesh>
      <mesh geometry={glowGeometry} position={[0, 0.02, 0]} renderOrder={3}>
        <meshBasicMaterial
          color={frozen ? "#f4fbff" : palette.waterGlow}
          depthWrite={false}
          side={THREE.DoubleSide}
          opacity={frozen ? 0.5 : 0.55}
          transparent
          vertexColors
        />
      </mesh>
      {frozen ? (
        <mesh position={[0.2, 0.034, 0.1]} renderOrder={3} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.38, 0.405, 6]} />
          <meshBasicMaterial color="#efffff" depthWrite={false} opacity={0.35} transparent />
        </mesh>
      ) : (
        <>
          <mesh
            ref={rippleOne}
            position={[0.28, 0.03, 0.08]}
            renderOrder={3}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.18, 0.205, 28]} />
            <meshBasicMaterial color={palette.waterGlow} depthWrite={false} opacity={0.18} transparent />
          </mesh>
          <mesh
            ref={rippleTwo}
            position={[-0.52, 0.032, -0.22]}
            renderOrder={3}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.15, 0.175, 28]} />
            <meshBasicMaterial color={palette.waterGlow} depthWrite={false} opacity={0.16} transparent />
          </mesh>
          {health > 0.42 ? (
            <group ref={fish} position={[0, 0.006, 0]}>
              {[0, 1].map((index) => {
                const angle = index * Math.PI;
                const color = index % 2 ? "#f4cf72" : "#f08b65";
                return (
                  <group
                    key={index}
                    position={[
                      Math.cos(angle) * (fishRadius + index * 0.1),
                      0,
                      Math.sin(angle) * fishRadius * 0.7,
                    ]}
                    rotation={[0, -angle + Math.PI / 2, 0]}
                  >
                    <mesh scale={[0.16, 0.035, 0.06]}>
                      <sphereGeometry args={[1, 8, 5]} />
                      <meshStandardMaterial color={color} roughness={0.5} />
                    </mesh>
                    <mesh
                      position={[-0.16, 0, 0]}
                      rotation={[0, 0, Math.PI / 2]}
                      scale={[0.08, 0.055, 0.03]}
                    >
                      <coneGeometry args={[1, 1, 3]} />
                      <meshStandardMaterial color={color} roughness={0.5} />
                    </mesh>
                  </group>
                );
              })}
            </group>
          ) : null}
          <LilyPads frame={frame} palette={palette} seed={seed + 5} />
          <Reeds
            frame={frame}
            health={health}
            palette={palette}
            seed={seed}
            tier={tier}
          />
        </>
      )}
    </group>
  );
}

function LilyPads({
  frame,
  palette,
  seed,
}: {
  frame: PondFrame;
  palette: WorldPalette;
  seed: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => createLilyPadGeometry(), []);
  const pads = useMemo(() => {
    const random = seededRandom(seed);
    return Array.from({ length: 7 }, (_, index) => {
      const heading = (index / 7) * TAU + (random() - 0.5) * 0.6;
      const reach = frame.shoreAt(heading) * (0.5 + random() * 0.32);
      return {
        x: Math.cos(heading) * reach,
        z: Math.sin(heading) * reach,
        rotation: random() * TAU,
        scale: 0.13 + random() * 0.1,
        shade: index % 3,
        flower: index === 1 || index === 4,
      };
    });
  }, [frame, seed]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    const shades = [
      new THREE.Color(palette.foliage[0]).multiplyScalar(0.85),
      new THREE.Color(palette.foliage[1]).multiplyScalar(0.8),
      new THREE.Color(palette.foliage[2]).multiplyScalar(0.78),
    ];
    pads.forEach((pad, index) => {
      dummy.position.set(pad.x, 0.022, pad.z);
      dummy.rotation.set(0, pad.rotation, 0);
      dummy.scale.setScalar(pad.scale);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
      mesh.current?.setColorAt(index, shades[pad.shade]);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [pads, palette.foliage]);

  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, undefined, pads.length]} renderOrder={3}>
        <meshStandardMaterial roughness={0.55} side={THREE.DoubleSide} />
      </instancedMesh>
      {pads
        .filter((pad) => pad.flower)
        .map((pad, index) => (
          <group key={index} position={[pad.x, 0.05, pad.z]}>
            <mesh scale={[0.075, 0.045, 0.075]}>
              <icosahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color="#fffaf2" flatShading roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.03, 0]} scale={0.022}>
              <sphereGeometry args={[1, 6, 4]} />
              <meshStandardMaterial color="#f2c94c" roughness={0.6} />
            </mesh>
          </group>
        ))}
    </>
  );
}

function Reeds({
  frame,
  health,
  palette,
  seed,
  tier,
}: {
  frame: PondFrame;
  health: number;
  palette: WorldPalette;
  seed: number;
  tier: TierSettings;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => createReedGeometry(), []);
  const reeds = useMemo(() => {
    const random = seededRandom(seed);
    const count = Math.max(10, Math.round(28 * tier.density));
    const patchCenters = [-0.55, 1.72, 3.55, 5.15].map(
      (angle) => angle + (random() - 0.5) * 0.35,
    );
    return Array.from({ length: count }, () => {
      const center = patchCenters[Math.floor(random() * patchCenters.length)] ?? 0;
      const heading = center + (random() - random()) * 0.42;
      const reach = frame.shoreAt(heading) * (0.98 + random() * 0.14);
      const x = Math.cos(heading) * reach;
      const z = Math.sin(heading) * reach;
      return {
        x,
        y: Math.max(0, frame.groundAt(x, z)) - 0.02,
        z,
        rotation: random() * TAU,
        scale: 0.42 + random() * 0.5,
        shade: Math.floor(random() * 3),
      };
    });
  }, [frame, seed, tier.density]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    const damp = new THREE.Color(palette.evergreen[1]);
    const colors = [
      damp.clone().lerp(new THREE.Color(palette.foliage[0]), 0.3 + health * 0.4),
      damp.clone().lerp(new THREE.Color(palette.foliage[1]), 0.4 + health * 0.4),
      damp.clone().lerp(new THREE.Color(palette.foliage[2]), 0.35 + health * 0.5),
    ];
    reeds.forEach((reed, index) => {
      dummy.position.set(reed.x, reed.y, reed.z);
      dummy.rotation.set(0, reed.rotation, (index % 2 ? 1 : -1) * 0.05);
      dummy.scale.set(1, 0.28 + reed.scale * 0.45, 1);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
      mesh.current?.setColorAt(index, colors[reed.shade]);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [health, palette.evergreen, palette.foliage, reeds]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, reeds.length]}
      castShadow={tier.shadows}
    >
      <meshStandardMaterial roughness={0.85} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

interface FallShape {
  geometry: THREE.BufferGeometry;
  /** World positions of the mist anchors: the lip and the base of the fall. */
  lip: THREE.Vector3;
  base: THREE.Vector3;
  /** Outward direction of the fall. */
  outward: THREE.Vector3;
}

interface RibbonRow {
  x: number;
  y: number;
  z: number;
  sideX: number;
  sideZ: number;
  half: number;
  stream: number;
  alpha: number;
  edgeAlpha: number;
}

/**
 * The heading of the rim point nearest the pond, snapped to a mesh segment so
 * the cliff profile below it is made of the island mesh's own vertices. This
 * is where the outflow channel leaves the pond and the waterfall pours over.
 */
function outflowRimAngle(edge: PhotorealIslandEdge, px: number, pz: number) {
  let bestAngle = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < 720; index += 1) {
    const angle = (index / 720) * TAU;
    const rim = edge.rimRadiusAt(angle);
    const distance = Math.hypot(Math.cos(angle) * rim - px, Math.sin(angle) * rim - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAngle = angle;
    }
  }
  const segmentAngle = TAU / edge.angularSegments;
  return Math.round(bestAngle / segmentAngle) * segmentAngle;
}

/**
 * Where the waterfall's outflow channel meets the island rim, for an island
 * of this radius, mesh quality and seed (the same inputs the Island uses).
 */
export function outflowRimPoint(
  islandRadius: number,
  pond: { x: number; z: number },
  quality: GardenQuality,
  seed: number,
): { x: number; z: number } {
  const edge = createPhotorealIslandEdge({ radius: islandRadius, quality, seed });
  const angle = outflowRimAngle(edge, pond.x, pond.z);
  const rim = edge.rimRadiusAt(angle);
  return { x: Math.cos(angle) * rim, z: Math.sin(angle) * rim };
}

/**
 * Builds the outflow channel and the falling stream as one ribbon: from inside
 * the pond to the nearest rim point, over the lip and down the cliff face,
 * just outside the island mesh's own cliff vertices.
 */
function createFallShape(
  islandRadius: number,
  px: number,
  pz: number,
  frame: PondFrame,
  sampler: PhotorealIslandSurfaceSampler,
  quality: GardenQuality,
  seed: number,
  channelColor: THREE.Color,
  streamColor: THREE.Color,
): FallShape {
  const edge = createPhotorealIslandEdge({ radius: islandRadius, quality, seed });
  const angle = outflowRimAngle(edge, px, pz);
  const outX = Math.cos(angle);
  const outZ = Math.sin(angle);
  const profile = edge.edgeProfileAt(angle).map(
    ([x, y, z]) => [x, y + ISLAND_SURFACE_OFFSET, z] as [number, number, number],
  );
  const [rimX, rimY, rimZ] = profile[0];

  const rows: RibbonRow[] = [];

  // Outflow channel, draped over the ground.
  const flowX = rimX - px;
  const flowZ = rimZ - pz;
  const flowLength = Math.hypot(flowX, flowZ);
  const dirX = flowX / flowLength;
  const dirZ = flowZ / flowLength;
  const shore = frame.shoreAt(Math.atan2(dirZ, dirX));
  const start = Math.max(0.2, shore - 0.35);
  const channelSteps = Math.max(4, Math.ceil((flowLength - start) / 0.3));
  for (let step = 0; step < channelSteps; step += 1) {
    const distance = start + ((flowLength - start) * step) / channelSteps;
    const x = px + dirX * distance;
    const z = pz + dirZ * distance;
    const ground = sampler(x, z);
    const groundY = ground === null ? rimY : ground + ISLAND_SURFACE_OFFSET;
    const y =
      distance <= shore
        ? Math.max(groundY + 0.045, frame.surfaceY + 0.006)
        : groundY + 0.045;
    rows.push({
      x,
      y,
      z,
      sideX: -dirZ,
      sideZ: dirX,
      half: CHANNEL_WIDTH / 2,
      stream: 0,
      alpha: step === 0 ? 0 : 0.92,
      edgeAlpha: step === 0 ? 0 : 0.4,
    });
  }

  // The lip: the rim itself, then a rounded pour over the soil band.
  const sideX = -outZ;
  const sideZ = outX;
  rows.push({
    x: rimX,
    y: rimY + 0.045,
    z: rimZ,
    sideX: (sideX - dirZ) / 2,
    sideZ: (sideZ + dirX) / 2,
    half: (CHANNEL_WIDTH + STREAM_WIDTH) / 4,
    stream: 0.4,
    alpha: 0.92,
    edgeAlpha: 0.3,
  });

  // The fall: each cliff vertex pushed a little outward, leaning out more as
  // it drops. The cliff below the bulge is an inverted cone, so the inward
  // drift is capped: the stream tracks the steep upper face and stays near the
  // lower face instead of lying flat along the underside.
  const clearance = (drop: number) => 0.12 + 0.1 * drop;
  const fall: Array<{ x: number; y: number; z: number; drop: number }> = [
    { x: rimX + outX * 0.1, y: rimY + 0.01, z: rimZ + outZ * 0.1, drop: 0 },
  ];
  let previousReach = (rimX + outX * 0.1) * outX + (rimZ + outZ * 0.1) * outZ;
  let previousDrop = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const [cx, cy, cz] = profile[index];
    let drop = rimY - cy;
    let x = cx;
    let y = cy;
    let z = cz;
    if (drop > STREAM_DROP) {
      const [ax, ay, az] = profile[index - 1];
      const aboveDrop = rimY - ay;
      const t = (STREAM_DROP - aboveDrop) / Math.max(1e-6, drop - aboveDrop);
      x = ax + (cx - ax) * t;
      y = ay + (cy - ay) * t;
      z = az + (cz - az) * t;
      drop = STREAM_DROP;
    }
    if (drop <= previousDrop) continue;
    x += outX * clearance(drop);
    z += outZ * clearance(drop);
    const reach = x * outX + z * outZ;
    const minimumReach = previousReach - 1.0 * (drop - previousDrop);
    if (reach < minimumReach) {
      x += outX * (minimumReach - reach);
      z += outZ * (minimumReach - reach);
    }
    previousReach = Math.max(reach, minimumReach);
    previousDrop = drop;
    fall.push({ x, y, z, drop });
    if (drop >= STREAM_DROP) break;
  }

  const finalDrop = fall[fall.length - 1].drop;
  for (let index = 0; index < fall.length - 1; index += 1) {
    const a = fall[index];
    const b = fall[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const pieces = Math.max(1, Math.ceil(length / 0.4));
    const last = index === fall.length - 2;
    for (let piece = 0; piece < pieces + (last ? 1 : 0); piece += 1) {
      const t = piece / pieces;
      const drop = a.drop + (b.drop - a.drop) * t;
      const progress = drop / Math.max(1e-6, finalDrop);
      const fade = 1 - smoothstep(0.62, 1, progress);
      rows.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        sideX,
        sideZ,
        half: (STREAM_WIDTH / 2) * (1 + progress * 0.4),
        stream: Math.min(1, 0.6 + drop * 2),
        alpha: fade,
        edgeAlpha: 0.3 * fade,
      });
    }
  }

  const positions = new Float32Array(rows.length * 3 * 3);
  const colors = new Float32Array(rows.length * 3 * 4);
  const uvs = new Float32Array(rows.length * 3 * 2);
  const indices: number[] = [];
  const color = new THREE.Color();
  let v = 0;
  rows.forEach((row, index) => {
    if (index > 0) {
      const previous = rows[index - 1];
      const length = Math.hypot(row.x - previous.x, row.y - previous.y, row.z - previous.z);
      // Short repeats in the channel read as a slow ripple; long ones on the
      // fall read as fast streaks.
      v += length / (row.stream > 0.5 ? 2.6 : 0.8);
    }
    color.copy(channelColor).lerp(streamColor, row.stream);
    for (let column = 0; column < 3; column += 1) {
      const offset = (column - 1) * row.half;
      const vertex = index * 3 + column;
      positions.set(
        [row.x + row.sideX * offset, row.y, row.z + row.sideZ * offset],
        vertex * 3,
      );
      colors.set(
        [color.r, color.g, color.b, column === 1 ? row.alpha : row.edgeAlpha],
        vertex * 4,
      );
      uvs.set([column / 2, v], vertex * 2);
    }
    if (index < rows.length - 1) {
      for (let column = 0; column < 2; column += 1) {
        const a = index * 3 + column;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const lipPoint = fall[Math.min(1, fall.length - 1)];
  const basePoint = fall.reduce((best, point) =>
    Math.abs(point.drop - finalDrop * 0.82) < Math.abs(best.drop - finalDrop * 0.82)
      ? point
      : best,
  );

  return {
    geometry,
    lip: new THREE.Vector3(lipPoint.x, lipPoint.y, lipPoint.z),
    base: new THREE.Vector3(basePoint.x, basePoint.y, basePoint.z),
    outward: new THREE.Vector3(outX, 0, outZ),
  };
}

function Waterfall({
  frame,
  frozen,
  islandRadius,
  palette,
  pondX,
  pondZ,
  quality,
  reducedMotion,
  seed,
  surfaceSampler,
  tier,
  weather,
}: {
  frame: PondFrame;
  frozen: boolean;
  islandRadius: number;
  palette: WorldPalette;
  pondX: number;
  pondZ: number;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  tier: TierSettings;
  weather: GardenWeather;
}) {
  const ribbon = useRef<THREE.Mesh>(null);
  const shape = useMemo(() => {
    const channel = new THREE.Color(palette.water).lerp(new THREE.Color(palette.waterGlow), 0.4);
    const stream = new THREE.Color(palette.waterGlow).lerp(new THREE.Color("#ffffff"), 0.7);
    return createFallShape(
      islandRadius,
      pondX,
      pondZ,
      frame,
      surfaceSampler,
      quality,
      seed,
      channel,
      stream,
    );
  }, [
    frame,
    islandRadius,
    palette.water,
    palette.waterGlow,
    pondX,
    pondZ,
    quality,
    seed,
    surfaceSampler,
  ]);
  const streaks = useMemo(() => createStreakTexture(seed + 211), [seed]);
  const iceColor = useMemo(
    () =>
      `#${new THREE.Color(palette.waterGlow)
        .lerp(new THREE.Color(palette.snow ?? "#eef3f5"), 0.6)
        .getHexString()}`,
    [palette.snow, palette.waterGlow],
  );

  useEffect(() => () => shape.geometry.dispose(), [shape]);
  useEffect(() => () => streaks.dispose(), [streaks]);

  useFrame((state) => {
    if (reducedMotion || frozen) return;
    const material = ribbon.current?.material as THREE.MeshStandardMaterial | undefined;
    if (!material?.map) return;
    const speed = weather === "rain" ? 1.25 : 1;
    material.map.offset.y = -((state.clock.elapsedTime * speed) % 1);
  });

  return (
    <group name="waterfall">
      <mesh ref={ribbon} geometry={shape.geometry} renderOrder={3}>
        {frozen ? (
          <meshStandardMaterial
            key="ice"
            alphaMap={streaks}
            color={iceColor}
            depthWrite={false}
            emissive="#e6f4ff"
            emissiveIntensity={0.22}
            map={streaks}
            metalness={0.05}
            roughness={0.4}
            side={THREE.DoubleSide}
            transparent
            vertexColors
          />
        ) : (
          <meshStandardMaterial
            key="water"
            alphaMap={streaks}
            depthWrite={false}
            emissive={palette.waterGlow}
            emissiveIntensity={0.3}
            map={streaks}
            metalness={0.05}
            roughness={0.15}
            side={THREE.DoubleSide}
            transparent
            vertexColors
          />
        )}
      </mesh>
      {tier.mist && !frozen ? (
        <Mist
          base={shape.base}
          lip={shape.lip}
          outward={shape.outward}
          reducedMotion={reducedMotion}
          seed={seed + 307}
        />
      ) : null}
    </group>
  );
}

/** About thirty soft puffs: a few at the lip, more at the base of the fall. */
function Mist({
  base,
  lip,
  outward,
  reducedMotion,
  seed,
}: {
  base: THREE.Vector3;
  lip: THREE.Vector3;
  outward: THREE.Vector3;
  reducedMotion: boolean;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const puff = useMemo(() => createPuffTexture(), []);
  const { geometry, anchors } = useMemo(() => {
    const random = seededRandom(seed);
    const count = MIST_LIP + MIST_BASE;
    // Per puff: anchor x, y, z, drift phase, spread.
    const data = new Float32Array(count * 5);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4).fill(1);
    for (let index = 0; index < count; index += 1) {
      const atLip = index < MIST_LIP;
      const anchor = atLip ? lip : base;
      const spread = atLip ? 0.35 : 0.7;
      const ax = anchor.x + (random() - 0.5) * spread + outward.x * random() * spread * 0.6;
      const ay = anchor.y + (random() - 0.5) * spread * 0.5;
      const az = anchor.z + (random() - 0.5) * spread + outward.z * random() * spread * 0.6;
      data.set([ax, ay, az, random(), spread], index * 5);
      positions.set([ax, ay, az], index * 3);
      colors[index * 4 + 3] = 0.75;
    }
    const mistGeometry = new THREE.BufferGeometry();
    mistGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    mistGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    mistGeometry.computeBoundingSphere();
    if (mistGeometry.boundingSphere) mistGeometry.boundingSphere.radius += 1.5;
    return { geometry: mistGeometry, anchors: data };
  }, [base, lip, outward, seed]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => puff.dispose(), [puff]);

  useFrame((state) => {
    if (reducedMotion || !points.current) return;
    const attribute = points.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colorAttribute = points.current.geometry.getAttribute("color") as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    const alphas = colorAttribute.array as Float32Array;
    const time = state.clock.elapsedTime;
    for (let index = 0; index < attribute.count; index += 1) {
      const cursor = index * 5;
      const phase = (time * 0.22 + anchors[cursor + 3]) % 1;
      const spread = anchors[cursor + 4];
      const swirl = Math.sin((time * 0.6 + anchors[cursor + 3] * 9) % TAU) * spread * 0.25;
      array[index * 3] = anchors[cursor] + outward.x * phase * spread * 0.5 + outward.z * swirl;
      array[index * 3 + 1] = anchors[cursor + 1] + phase * spread * 0.6;
      array[index * 3 + 2] = anchors[cursor + 2] + outward.z * phase * spread * 0.5 - outward.x * swirl;
      // Fade each puff in and out so the loop back to its anchor is invisible.
      alphas[index * 4 + 3] = Math.sin(phase * Math.PI);
    }
    attribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} renderOrder={4}>
      <pointsMaterial
        color="#ffffff"
        depthWrite={false}
        map={puff}
        opacity={0.5}
        size={0.7}
        sizeAttenuation
        transparent
        vertexColors
      />
    </points>
  );
}
