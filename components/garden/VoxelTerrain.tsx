"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type {
  GardenSeason,
  GardenSelection,
  GardenStats,
  GardenTimeOfDay,
} from "./types";
import type { PhotorealIslandSurfaceSampler } from "./photoreal-geometry";

export const VOXEL_SIZE = 0.78;
const VOXEL_HEIGHT_STEP = 0.26;
const ISLAND_RADIUS = 11.5;
const POND_X = -2.35;
const POND_Z = 1.25;

interface VoxelPalette {
  ground: string;
  groundDry: string;
  earth: string;
  cliff: string;
  stone: string;
  stoneLight: string;
  water: string;
  waterGlow: string;
}

interface VoxelTerrainProps {
  health: number;
  palette: VoxelPalette;
  season: GardenSeason;
  seed: number;
  stats: GardenStats;
  surfaceOffset: number;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  timeOfDay: GardenTimeOfDay;
  onSelect?: (selection: GardenSelection | null) => void;
}

interface VoxelInstance {
  color: THREE.Color;
  position: [number, number, number];
  scale: [number, number, number];
}

interface VoxelLayout {
  dirt: VoxelInstance[];
  pads: VoxelInstance[];
  stone: VoxelInstance[];
  tops: VoxelInstance[];
  water: VoxelInstance[];
  waterSurfaceY: number;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function gridHash(x: number, z: number, seed: number) {
  let value =
    Math.imul(x, 0x1f123bb5) ^
    Math.imul(z, 0x5f356495) ^
    Math.imul(seed, 0x6c8e9cf5);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  return ((value ^ (value >>> 13)) >>> 0) / 4294967295;
}

function shadedColor(
  primary: string,
  secondary: string,
  mix: number,
  shade: number,
) {
  const color = new THREE.Color(primary).lerp(
    new THREE.Color(secondary),
    clamp01(mix),
  );
  color.offsetHSL(0, 0, (shade - 0.5) * 0.1);
  return color;
}

function pondDistance(x: number, z: number) {
  return (
    ((x - POND_X) / 2.15) ** 2 +
    ((z - POND_Z) / 1.45) ** 2
  );
}

function pathDistance(x: number, z: number) {
  return Math.abs(z + x * 0.24 + 2.3) / Math.sqrt(1 + 0.24 ** 2);
}

function fillInstances(
  mesh: THREE.InstancedMesh | null,
  instances: VoxelInstance[],
) {
  if (!mesh) return;
  const dummy = new THREE.Object3D();

  instances.forEach((instance, index) => {
    dummy.position.set(...instance.position);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(...instance.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, instance.color);
  });

  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function createVoxelSurfaceSampler(
  surfaceSampler: PhotorealIslandSurfaceSampler,
): PhotorealIslandSurfaceSampler {
  return (x, z) => {
    if (surfaceSampler(x, z) === null) return null;
    const snappedX = Math.round(x / VOXEL_SIZE) * VOXEL_SIZE;
    const snappedZ = Math.round(z / VOXEL_SIZE) * VOXEL_SIZE;
    const height = surfaceSampler(snappedX, snappedZ);
    if (height === null) return null;
    return Math.round(height / VOXEL_HEIGHT_STEP) * VOXEL_HEIGHT_STEP;
  };
}

export function VoxelTerrain({
  health,
  palette,
  season,
  seed,
  stats,
  surfaceOffset,
  surfaceSampler,
  timeOfDay,
  onSelect,
}: VoxelTerrainProps) {
  const topRef = useRef<THREE.InstancedMesh>(null);
  const dirtRef = useRef<THREE.InstancedMesh>(null);
  const stoneRef = useRef<THREE.InstancedMesh>(null);
  const waterRef = useRef<THREE.InstancedMesh>(null);
  const padRef = useRef<THREE.InstancedMesh>(null);
  const safeHealth = clamp01(health);

  const layout = useMemo<VoxelLayout>(() => {
    const tops: VoxelInstance[] = [];
    const dirt: VoxelInstance[] = [];
    const stone: VoxelInstance[] = [];
    const water: VoxelInstance[] = [];
    const pads: VoxelInstance[] = [];
    const half = VOXEL_SIZE / 2;
    const horizontalScale = VOXEL_SIZE * 0.965;
    const waterSurfaceY =
      (surfaceSampler(POND_X, POND_Z) ?? 0) + surfaceOffset + 0.24;
    const extent = Math.ceil(ISLAND_RADIUS / VOXEL_SIZE);
    const winter = season === "winter";

    for (let gridX = -extent; gridX <= extent; gridX += 1) {
      for (let gridZ = -extent; gridZ <= extent; gridZ += 1) {
        const x = gridX * VOXEL_SIZE;
        const z = gridZ * VOXEL_SIZE;
        const sampledY = surfaceSampler(x, z);
        if (sampledY === null) continue;

        const radius = Math.hypot(x, z);
        const normalizedRadius = clamp01(radius / ISLAND_RADIUS);
        const centerWeight = 1 - normalizedRadius;
        const random = gridHash(gridX, gridZ, seed);
        const pond = pondDistance(x, z) < 1;
        const path =
          !pond &&
          pathDistance(x, z) < 0.48 &&
          Math.abs(x) < ISLAND_RADIUS * 0.72;
        const topY = sampledY + surfaceOffset;
        const commonScale: [number, number, number] = [
          horizontalScale,
          VOXEL_SIZE,
          horizontalScale,
        ];

        if (pond) {
          water.push({
            color: shadedColor(
              winter ? "#afc9ce" : palette.water,
              winter ? "#e5efee" : palette.waterGlow,
              0.18 + random * 0.32,
              random,
            ),
            position: [x, waterSurfaceY - 0.075, z],
            scale: [horizontalScale, 0.15, horizontalScale],
          });

          if (
            !winter &&
            random > 0.76 &&
            pads.length < 8 &&
            pads.every(
              (pad) =>
                Math.hypot(pad.position[0] - x, pad.position[2] - z) >
                VOXEL_SIZE * 1.15,
            )
          ) {
            pads.push({
              color: shadedColor(
                palette.ground,
                palette.groundDry,
                0.06,
                random,
              ),
              position: [x, waterSurfaceY + 0.022, z],
              scale: [VOXEL_SIZE * 0.48, 0.06, VOXEL_SIZE * 0.48],
            });
          }
        } else {
          const seasonalTop =
            season === "autumn"
              ? palette.groundDry
              : winter
                ? "#d5ddd7"
                : palette.ground;
          tops.push({
            color: path
              ? shadedColor(
                  palette.stone,
                  palette.stoneLight,
                  0.2 + random * 0.42,
                  random,
                )
              : shadedColor(
                  seasonalTop,
                  palette.groundDry,
                  (1 - safeHealth) * 0.38 + random * 0.1,
                  random,
                ),
            position: [x, topY - half, z],
            scale: commonScale,
          });
        }

        const columnTop = pond
          ? waterSurfaceY - 0.16
          : topY - VOXEL_SIZE;
        const underLayers = Math.max(
          1,
          Math.round(
            1.25 +
              Math.pow(centerWeight, 1.32) * 6.7 +
              (random - 0.5) * 1.35,
          ),
        );
        const dirtLayers = Math.min(
          underLayers,
          pond ? 2 : centerWeight > 0.34 ? 2 : 1,
        );

        for (let layer = 0; layer < underLayers; layer += 1) {
          const target = layer < dirtLayers ? dirt : stone;
          const layerShade = gridHash(gridX, gridZ, seed + layer * 101);
          target.push({
            color:
              layer < dirtLayers
                ? shadedColor(
                    palette.earth,
                    palette.groundDry,
                    0.08 + layerShade * 0.2,
                    layerShade,
                  )
                : shadedColor(
                    palette.cliff,
                    palette.stone,
                    0.2 + layerShade * 0.42,
                    layerShade,
                  ),
            position: [
              x,
              columnTop - half - layer * VOXEL_SIZE,
              z,
            ],
            scale: commonScale,
          });
        }
      }
    }

    return {
      dirt,
      pads,
      stone,
      tops,
      water,
      waterSurfaceY,
    };
  }, [
    palette.cliff,
    palette.earth,
    palette.ground,
    palette.groundDry,
    palette.stone,
    palette.stoneLight,
    palette.water,
    palette.waterGlow,
    safeHealth,
    season,
    seed,
    surfaceOffset,
    surfaceSampler,
  ]);

  useLayoutEffect(() => {
    fillInstances(topRef.current, layout.tops);
    fillInstances(dirtRef.current, layout.dirt);
    fillInstances(stoneRef.current, layout.stone);
    fillInstances(waterRef.current, layout.water);
    fillInstances(padRef.current, layout.pads);
  }, [layout]);

  const selectPond = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.({
      kind: "water",
      id: "voxel-pond",
      title: season === "winter" ? "Frozen spring" : "Reflection pond",
      subtitle: "Ecosystem activity",
      description:
        "A stepped pool mirrors the health of the contribution garden.",
      accent: season === "winter" ? "#c5dadd" : palette.waterGlow,
      worldPosition: [POND_X, layout.waterSurfaceY, POND_Z],
      count: stats.totalContributions,
      details: [
        {
          label: "Garden health",
          value: `${Math.round(safeHealth * 100)}%`,
        },
        {
          label: "Contributions",
          value: stats.totalContributions.toLocaleString(),
        },
        { label: "Light", value: timeOfDay },
      ],
    });
  };

  return (
    <group name="voxel-island">
      <instancedMesh
        ref={topRef}
        args={[undefined, undefined, layout.tops.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.96} />
      </instancedMesh>

      <instancedMesh
        ref={dirtRef}
        args={[undefined, undefined, layout.dirt.length]}
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>

      <instancedMesh
        ref={stoneRef}
        args={[undefined, undefined, layout.stone.length]}
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>

      <instancedMesh
        ref={waterRef}
        args={[undefined, undefined, layout.water.length]}
        onClick={selectPond}
        onPointerOver={(event) => {
          event.stopPropagation();
          const target = event.nativeEvent.target;
          if (target instanceof HTMLElement) target.style.cursor = "pointer";
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          const target = event.nativeEvent.target;
          if (target instanceof HTMLElement) target.style.cursor = "grab";
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          opacity={season === "winter" ? 0.96 : 0.88}
          roughness={season === "winter" ? 0.48 : 0.22}
          transparent
        />
      </instancedMesh>

      <instancedMesh
        ref={padRef}
        args={[undefined, undefined, layout.pads.length]}
        castShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.94} />
      </instancedMesh>
    </group>
  );
}
