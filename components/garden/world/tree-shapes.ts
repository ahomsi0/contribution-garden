/**
 * Pure tree shapes: trunk and branch segments, canopy-blob transforms and pine
 * tiers in tree-local units. `Trees.tsx` turns them into instances.
 */

export type TreeKind = "deciduous" | "evergreen" | "great";
export type Vec3 = [number, number, number];

/** One smooth canopy blob, in tree-local units (before the tree's scale). */
export interface CanopyBlob {
  position: Vec3;
  radius: number;
  /** Vertical squash: blobs are a little flatter than they are wide. */
  squash: number;
  yaw: number;
  /** 0 for the lowest blobs, 1 for the crown: higher blobs catch more sun. */
  height: number;
  /** -1..1 per-blob lightness jitter. */
  shade: number;
  /** A small winter tuft rather than a full canopy blob. */
  tuft: boolean;
}

/** A tapered wood segment drawn from an instanced cylinder. */
export interface WoodSegment {
  from: Vec3;
  to: Vec3;
  radius: number;
}

/** One stacked cone of an evergreen. */
export interface PineTier {
  y: number;
  height: number;
  radius: number;
  yaw: number;
}

/** A curved, gnarled limb of the great tree (a tube along `path`). */
export interface GreatLimb {
  path: Vec3[];
  radius: [number, number];
  /** The trunk: flared at the base into the roots. */
  flare?: boolean;
  gnarl: number;
}

export interface TreeShape {
  kind: TreeKind;
  /** Approximate height at scale 1. */
  height: number;
  /** Year trees: the instanced trunk. Null for the great tree. */
  trunk: WoodSegment | null;
  branches: WoodSegment[];
  blobs: CanopyBlob[];
  cones: PineTier[];
  /** Great tree only: trunk, roots and limbs for the gnarled wood mesh. */
  limbs: GreatLimb[];
  /** Great tree only: the root headings, so the trunk can flare into them. */
  rootAngles: number[];
}

export const TAU = Math.PI * 2;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function buildDeciduous(rand: () => number, bare: boolean): TreeShape {
  const height = 2.3 + rand() * 0.6;
  const leanX = (rand() - 0.5) * 0.12 * height;
  const leanZ = (rand() - 0.5) * 0.12 * height;
  const trunkTop: Vec3 = [leanX, 0.56 * height, leanZ];
  const trunk: WoodSegment = {
    from: [0, -0.12, 0],
    to: trunkTop,
    radius: 0.058 * height,
  };
  const blobs: CanopyBlob[] = [];
  const branches: WoodSegment[] = [];

  const crown: Vec3 = [leanX * 1.3, 0.76 * height, leanZ * 1.3];
  if (!bare) {
    blobs.push({
      position: crown,
      radius: 0.34 * height * (0.95 + rand() * 0.1),
      squash: 0.9,
      yaw: rand() * TAU,
      height: 1,
      shade: rand() * 2 - 1,
      tuft: false,
    });
  }

  const sides = 3 + Math.floor(rand() * 3); // 3..5, so 4..6 blobs in all
  const branchCount = rand() < 0.5 ? 2 : 3;
  const phase = rand() * TAU;
  for (let k = 0; k < sides; k += 1) {
    const angle = phase + (k * TAU) / sides + (rand() - 0.5) * 0.5;
    const reach = (0.2 + rand() * 0.05) * height;
    const centre: Vec3 = [
      leanX + Math.cos(angle) * reach,
      (0.6 + rand() * 0.06) * height,
      leanZ + Math.sin(angle) * reach,
    ];
    const radius = (0.23 + rand() * 0.04) * height;
    const shade = rand() * 2 - 1;
    const yaw = rand() * TAU;
    if (!bare) {
      blobs.push({ position: centre, radius, squash: 0.85, yaw, height: 0.45, shade, tuft: false });
    }
    const forkAt = 0.42 + rand() * 0.12;
    const from = lerp3(trunk.from, trunkTop, forkAt / 0.56);
    if (k < branchCount) {
      // Leafy trees show short stubs into the canopy; bare trees reach out.
      const to = bare
        ? ([centre[0], centre[1] + 0.1 * height, centre[2]] as Vec3)
        : lerp3(from, centre, 0.75);
      branches.push({ from, to, radius: 0.026 * height });
      if (bare) {
        const mid = lerp3(from, to, 0.62);
        for (let twig = 0; twig < 2; twig += 1) {
          const twigAngle = angle + (twig === 0 ? -0.7 : 0.7) + (rand() - 0.5) * 0.3;
          branches.push({
            from: mid,
            to: [
              mid[0] + Math.cos(twigAngle) * 0.16 * height,
              mid[1] + (0.14 + rand() * 0.08) * height,
              mid[2] + Math.sin(twigAngle) * 0.16 * height,
            ],
            radius: 0.012 * height,
          });
        }
        if (k < 2) {
          blobs.push({
            position: to,
            radius: 0.1 * height,
            squash: 0.8,
            yaw,
            height: 0.6,
            shade,
            tuft: true,
          });
        }
      }
    }
  }
  if (bare) {
    // A leader up the middle, so the bare crown reads as a tree.
    branches.push({
      from: trunkTop,
      to: [crown[0], crown[1] + 0.05 * height, crown[2]],
      radius: 0.03 * height,
    });
  }

  return { kind: "deciduous", height, trunk, branches, blobs, cones: [], limbs: [], rootAngles: [] };
}

function buildEvergreen(rand: () => number): TreeShape {
  const height = 2.8 + rand() * 0.6;
  const tiers = rand() < 0.3 ? 3 : 4;
  const spacing = tiers === 3 ? 0.25 : 0.19;
  const cones: PineTier[] = [];
  for (let k = 0; k < tiers; k += 1) {
    cones.push({
      y: (0.18 + k * spacing) * height,
      height: 0.4 * height * (1 - 0.12 * k),
      radius: 0.34 * height * (1 - 0.2 * k) * (0.95 + rand() * 0.1),
      yaw: rand() * TAU,
    });
  }
  return {
    kind: "evergreen",
    height,
    trunk: { from: [0, -0.12, 0], to: [0, 0.32 * height, 0], radius: 0.05 * height },
    branches: [],
    blobs: [],
    cones,
    limbs: [],
    rootAngles: [],
  };
}

function buildGreat(rand: () => number, bare: boolean): TreeShape {
  const baseYaw = rand() * TAU;
  const limbs: GreatLimb[] = [];
  const blobs: CanopyBlob[] = [];
  const branches: WoodSegment[] = [];

  limbs.push({
    path: [
      [0, -0.35, 0],
      [0.06, 0.7, 0.03],
      [-0.1, 1.5, 0.08],
      [0.04, 2.3, -0.02],
    ],
    radius: [0.6, 0.38],
    flare: true,
    gnarl: 0.09,
  });

  const rootAngles: number[] = [];
  for (let k = 0; k < 5; k += 1) {
    const a = baseYaw + 0.3 + (k * TAU) / 5 + (rand() - 0.5) * 0.4;
    rootAngles.push(a);
    const reach = 1.45 + rand() * 0.5;
    const c = Math.cos(a);
    const s = Math.sin(a);
    limbs.push({
      path: [
        [c * 0.3, 0.55, s * 0.3],
        [c * 0.75, 0.18, s * 0.75],
        [c * reach * 0.8, -0.06, s * reach * 0.8],
        [c * reach, -0.32, s * reach],
      ],
      radius: [0.25, 0.05],
      gnarl: 0.08,
    });
  }

  // Four limbs spread into the umbrella, plus a leader up the middle.
  const limbEnds: { angle: number; reach: number; y: number }[] = [];
  for (let k = 0; k < 4; k += 1) {
    const a = baseYaw + (k * TAU) / 4 + (rand() - 0.5) * 0.35;
    const reach = 1.5 + rand() * 0.3;
    const endY = 3.7 + rand() * 0.25;
    limbEnds.push({ angle: a, reach, y: endY });
    const c = Math.cos(a);
    const s = Math.sin(a);
    const start: Vec3 = [c * 0.12, 1.95 + k * 0.08, s * 0.12];
    const path: Vec3[] = [
      start,
      [c * 0.6, 2.7, s * 0.6],
      [c * reach * 0.75, 3.35, s * reach * 0.75],
      [c * reach, endY, s * reach],
    ];
    limbs.push({ path, radius: [0.3, 0.09], gnarl: 0.07 });

    // A fork off each limb toward the gap before the next one.
    const forkAngle = a + 0.75;
    const fork = path[2];
    limbs.push({
      path: [
        fork,
        [
          Math.cos(forkAngle) * reach * 0.85,
          (fork[1] + endY) / 2 + 0.15,
          Math.sin(forkAngle) * reach * 0.85,
        ],
        [Math.cos(forkAngle) * 1.25, 4.0, Math.sin(forkAngle) * 1.25],
      ],
      radius: [0.11, 0.04],
      gnarl: 0.05,
    });

    if (bare) {
      // Bare winter limbs end in a spray of twigs.
      for (let twig = 0; twig < 3; twig += 1) {
        const ta = a + (twig - 1) * 0.55 + (rand() - 0.5) * 0.2;
        branches.push({
          from: [c * reach, endY - 0.05, s * reach],
          to: [
            c * reach + Math.cos(ta) * 0.55,
            endY + 0.45 + rand() * 0.35,
            s * reach + Math.sin(ta) * 0.55,
          ],
          radius: 0.035,
        });
      }
    }
  }
  limbs.push({
    path: [
      [0.02, 2.0, 0],
      [0.1, 3.0, -0.05],
      [0, 3.7, 0.05],
      [0.05, 4.3, 0],
    ],
    radius: [0.26, 0.08],
    gnarl: 0.06,
  });

  if (bare) {
    for (let k = 0; k < 3; k += 1) {
      const end = limbEnds[k];
      blobs.push({
        position: [Math.cos(end.angle) * end.reach, end.y + 0.1, Math.sin(end.angle) * end.reach],
        radius: 0.3,
        squash: 0.8,
        yaw: rand() * TAU,
        height: 0.6,
        shade: rand() * 2 - 1,
        tuft: true,
      });
    }
  } else {
    // A wide, layered umbrella: a high crown, an inner ring, and a lower,
    // flatter outer ring over the limb ends.
    blobs.push({
      position: [0, 4.55, 0],
      radius: 1.25,
      squash: 0.76,
      yaw: rand() * TAU,
      height: 1,
      shade: rand() * 2 - 1,
      tuft: false,
    });
    for (let k = 0; k < 3; k += 1) {
      const a = baseYaw + 0.4 + (k * TAU) / 3;
      blobs.push({
        position: [Math.cos(a) * 0.95, 4.35 + rand() * 0.15, Math.sin(a) * 0.95],
        radius: 1.02 + rand() * 0.1,
        squash: 0.78,
        yaw: rand() * TAU,
        height: 0.8,
        shade: rand() * 2 - 1,
        tuft: false,
      });
    }
    for (const end of limbEnds) {
      blobs.push({
        position: [
          Math.cos(end.angle) * end.reach,
          end.y + 0.2,
          Math.sin(end.angle) * end.reach,
        ],
        radius: 0.98 + rand() * 0.16,
        squash: 0.76,
        yaw: rand() * TAU,
        height: 0.35,
        shade: rand() * 2 - 1,
        tuft: false,
      });
    }
    if (rand() < 0.6) {
      const a = limbEnds[1].angle + 0.75;
      blobs.push({
        position: [Math.cos(a) * 1.55, 4.05, Math.sin(a) * 1.55],
        radius: 0.92,
        squash: 0.76,
        yaw: rand() * TAU,
        height: 0.3,
        shade: rand() * 2 - 1,
        tuft: false,
      });
    }
    // Smaller clumps tucked under the rim and between the big blobs, so the
    // umbrella reads as layered foliage rather than a stack of domes.
    for (let k = 0; k < 6; k += 1) {
      const a = baseYaw + 0.5 + (k * TAU) / 6 + (rand() - 0.5) * 0.3;
      const reach = 1.85 + rand() * 0.35;
      blobs.push({
        position: [Math.cos(a) * reach, 3.7 + rand() * 0.25, Math.sin(a) * reach],
        radius: 0.6 + rand() * 0.15,
        squash: 0.8,
        yaw: rand() * TAU,
        height: 0.15,
        shade: rand() * 2 - 1,
        tuft: false,
      });
    }
  }

  return { kind: "great", height: 5.5, trunk: null, branches, blobs, cones: [], limbs, rootAngles };
}

/**
 * The shared tree builder. Deterministic for a seed. `bare` gives the winter
 * form of a deciduous tree: trunk, branches and a few small tufts.
 */
export function buildTree(
  kind: TreeKind,
  seed: number,
  options: { bare?: boolean } = {},
): TreeShape {
  const rand = mulberry32(seed);
  const bare = options.bare ?? false;
  if (kind === "evergreen") return buildEvergreen(rand);
  if (kind === "great") return buildGreat(rand, bare);
  return buildDeciduous(rand, bare);
}
