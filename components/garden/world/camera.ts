/**
 * Pure camera framing for the orbit view: where the default camera sits and
 * how far it may zoom, so a radius-9 island and a radius-13 island with a
 * full-grown great tree both fill the frame, the crown stays clear of the UI
 * along the top, and the waterfall reads from the side.
 */

import { GREAT_TREE_POSITION } from "./mapping";

export type Vec3 = [number, number, number];

export interface CameraFraming {
  position: Vec3;
  target: Vec3;
  minDistance: number;
  maxDistance: number;
  /** Camera azimuth around the target, radians, atan2(z, x). */
  azimuth: number;
  /** Camera elevation above the target, radians. */
  elevation: number;
  distance: number;
}

/** A crown that must stay in frame: its top and its horizontal radius. */
export interface FramingPeak {
  x: number;
  z: number;
  top: number;
  crownRadius: number;
}

export interface FramingOptions {
  /** Vertical field of view, degrees. */
  fov?: number;
  /** Canvas width / height. */
  aspect?: number;
  /**
   * Fraction of the frame height the top bar and weather switch cover. No
   * crown may reach into it.
   */
  topBand?: number;
  /** Fraction of the frame height the timeline covers at the bottom. */
  bottomBand?: number;
  /** Where the great tree stands. */
  greatTree?: { x: number; z: number };
  /** Other crowns that should stay clear of the top band (year trees). */
  peaks?: ReadonlyArray<FramingPeak>;
  /**
   * The island's actual rim radius by angle (radians, atan2(z, x)). Defaults
   * to a circle of `islandRadius`.
   */
  rimRadiusAt?: (angle: number) => number;
}

export const CAMERA_FOV = 42;
/** Camera elevation above the target. */
export const CAMERA_ELEVATION = (32 * Math.PI) / 180;
/**
 * How far the camera's azimuth sits from the waterfall's. The camera turns
 * past the waterfall so it shows on the right of the frame: on a desktop the
 * stats panel covers the left.
 */
export const WATERFALL_OFFSET = (38 * Math.PI) / 180;
/**
 * How much of the frame the page UI covers. On a wide screen the top bar and
 * weather switch take the top 12% (down to about 16° above the view axis at
 * fov 42) and the timeline the bottom 8.5%. On a tall screen the top bar and
 * home button take about 13% and the dock and timeline about 18%.
 */
export function uiBandsFor(aspect: number) {
  return aspect >= 1
    ? { topBand: 0.12, bottomBand: 0.085 }
    : { topBand: 0.13, bottomBand: 0.18 };
}
/** Crowns keep this many degrees clear of the top band. */
const TOP_MARGIN = 2;
const BOTTOM_MARGIN = 0.6;
/** The furthest the orbit camera may zoom out, unless the framing needs more. */
const MAX_ZOOM_OUT = 48;
/** The narrowest frame the island is fitted across. */
const MIN_FIT_ASPECT = 0.7;
/** The distance the old fixed camera used, for scaling fog with the framing. */
export const REFERENCE_DISTANCE = 26.7;
/** Crown tops at scale 1, from `tree-shapes.ts`: the great tree and year trees. */
export const GREAT_TREE_TOP = 5.5;
export const YEAR_TREE_TOP = 3.45;
export const YEAR_CROWN_RADIUS = 1.6;
/** Ground level along the rim, a little below y = 0. */
const RIM_Y = -0.6;
/** Great tree crown radius as a fraction of its top height. */
const GREAT_CROWN_RATIO = 0.5;

const DEG = Math.PI / 180;
/** Target heights the search considers, world y. */
const MIN_TARGET_Y = -3;
const MAX_TARGET_Y = 8;
/** Heights in the coarse pass, golden-section steps in the refinement. */
const COARSE_HEIGHTS = 12;
const REFINE_STEPS = 8;
/** Bisection steps on the distance: about 1e-5 of the search range. */
const BISECTION_STEPS = 20;
/** The 0.1-spaced heights the final centring pass compares. */
const BALANCE_HEIGHTS = Math.round((MAX_TARGET_Y - MIN_TARGET_Y) / 0.1) + 1;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

interface Pose {
  /** Unit vector from target to camera. */
  back: Vec3;
  right: Vec3;
  up: Vec3;
}

function poseFor(azimuth: number, elevation: number): Pose {
  const back: Vec3 = [
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  ];
  // right = normalize(worldUp × back), up = back × right.
  const rx = back[2];
  const rz = -back[0];
  const rl = Math.hypot(rx, rz);
  const right: Vec3 = [rx / rl, 0, rz / rl];
  const up: Vec3 = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  return { back, right, up };
}

/** Screen angles (degrees) of a point: [horizontal, vertical] off the view axis. */
function viewAngles(
  pose: Pose,
  target: Vec3,
  distance: number,
  point: Vec3,
): [number, number] {
  const cx = target[0] + pose.back[0] * distance;
  const cy = target[1] + pose.back[1] * distance;
  const cz = target[2] + pose.back[2] * distance;
  const dx = point[0] - cx;
  const dy = point[1] - cy;
  const dz = point[2] - cz;
  const depth = -(dx * pose.back[0] + dy * pose.back[1] + dz * pose.back[2]);
  if (depth <= 0.01) return [90, 90];
  const x = dx * pose.right[0] + dy * pose.right[1] + dz * pose.right[2];
  const y = dx * pose.up[0] + dy * pose.up[1] + dz * pose.up[2];
  return [Math.atan(x / depth) / DEG, Math.atan(y / depth) / DEG];
}

/** Points sampled over a crown: its top and a ring just below it. */
function crownPoints(peak: FramingPeak): Vec3[] {
  const points: Vec3[] = [[peak.x, peak.top, peak.z]];
  const ringY = peak.top - 0.3 * peak.crownRadius;
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    points.push([
      peak.x + Math.cos(angle) * peak.crownRadius,
      ringY,
      peak.z + Math.sin(angle) * peak.crownRadius,
    ]);
  }
  return points;
}

function rimPoints(rimRadiusAt: (angle: number) => number): Vec3[] {
  return Array.from({ length: 72 }, (_, index) => {
    const angle = (index / 72) * Math.PI * 2;
    const radius = rimRadiusAt(angle);
    return [Math.cos(angle) * radius, RIM_Y, Math.sin(angle) * radius] as Vec3;
  });
}

/**
 * Where the default orbit camera sits for an island of this radius, a great
 * tree whose crown tops out at `greatTreeHeight` (world y), and a waterfall
 * pouring over the rim at `waterfallAzimuth` (radians, atan2(z, x)).
 *
 * The camera keeps a fixed elevation, turns so the waterfall sits about 38°
 * to the right of the view axis, and then takes the closest distance (and the target
 * height that allows it) at which the whole island fits across the frame,
 * the near rim clears the bottom bar and every crown stays under the top bar.
 */
export function cameraFraming(
  islandRadius: number,
  greatTreeHeight: number,
  waterfallAzimuth: number,
  options: FramingOptions = {},
): CameraFraming {
  const fov = options.fov ?? CAMERA_FOV;
  const aspect = options.aspect ?? 16 / 10;
  const halfTan = Math.tan((fov / 2) * DEG);
  // A band covering fraction f of the frame height ends at screen y 1 - 2f.
  const bandEdge = (fraction: number) => Math.atan((1 - 2 * fraction) * halfTan) / DEG;
  const bands = uiBandsFor(aspect);
  const topLimit = bandEdge(options.topBand ?? bands.topBand) - TOP_MARGIN;
  const bottomLimit =
    -bandEdge(options.bottomBand ?? bands.bottomBand) + BOTTOM_MARGIN;
  // Tall phone screens crop the island's sides rather than shrink it to a
  // speck: the width fit never assumes a frame narrower than MIN_FIT_ASPECT.
  const halfWidth = Math.atan(halfTan * Math.max(aspect, MIN_FIT_ASPECT)) / DEG;
  const sideLimit = halfWidth * 0.97;
  const great = options.greatTree ?? GREAT_TREE_POSITION;

  const azimuth = waterfallAzimuth + WATERFALL_OFFSET;
  const elevation = CAMERA_ELEVATION;
  const pose = poseFor(azimuth, elevation);

  const tops: Vec3[] = [
    ...crownPoints({
      x: great.x,
      z: great.z,
      top: greatTreeHeight,
      crownRadius: Math.max(1.6, greatTreeHeight * GREAT_CROWN_RATIO),
    }),
    ...(options.peaks ?? []).flatMap(crownPoints),
  ];
  const rim = rimPoints(options.rimRadiusAt ?? (() => islandRadius));

  // With the target at (0, targetY, 0) and the camera `distance` back along
  // the view axis, a point's depth, horizontal and vertical offsets are all
  // linear in targetY and distance, so each point is reduced to three
  // dot products once. `right` has no y component and is perpendicular to
  // `back` and `up`, which keeps the offsets free of the distance term.
  const project = (points: Vec3[]) => {
    const along = new Float64Array(points.length);
    const across = new Float64Array(points.length);
    const lift = new Float64Array(points.length);
    points.forEach(([x, y, z], index) => {
      along[index] = x * pose.back[0] + y * pose.back[1] + z * pose.back[2];
      across[index] = x * pose.right[0] + z * pose.right[2];
      lift[index] = x * pose.up[0] + y * pose.up[1] + z * pose.up[2];
    });
    return { along, across, lift, count: points.length };
  };
  const topPoints = project(tops);
  const rimProjected = project(rim);
  const toDegrees = (ratio: number) => Math.atan(ratio) / DEG;

  // Clearances in degrees, each positive when everything fits. Angles are
  // monotonic in their tangent, so only the extreme tangents need an atan.
  const clearances = (targetY: number, distance: number) => {
    const depthBase = distance + targetY * pose.back[1];
    const liftBase = targetY * pose.up[1];
    let topRatio = -Infinity;
    for (let index = 0; index < topPoints.count; index += 1) {
      const depth = depthBase - topPoints.along[index];
      const ratio =
        depth <= 0.01 ? Infinity : (topPoints.lift[index] - liftBase) / depth;
      if (ratio > topRatio) topRatio = ratio;
    }
    let rimHigh = -Infinity;
    let rimLow = Infinity;
    let rimWide = 0;
    for (let index = 0; index < rimProjected.count; index += 1) {
      const depth = depthBase - rimProjected.along[index];
      if (depth <= 0.01) {
        // Behind the camera: the old per-point maths called this 90°.
        rimHigh = Infinity;
        rimWide = Infinity;
        continue;
      }
      const vertical = (rimProjected.lift[index] - liftBase) / depth;
      const horizontal = Math.abs(rimProjected.across[index] / depth);
      if (vertical > rimHigh) rimHigh = vertical;
      if (vertical < rimLow) rimLow = vertical;
      if (horizontal > rimWide) rimWide = horizontal;
    }
    const highest = Math.max(topRatio, rimHigh);
    return {
      top: highest === -Infinity ? Infinity : topLimit - toDegrees(highest),
      bottom: rimLow === Infinity ? Infinity : toDegrees(rimLow) - bottomLimit,
      side: rimProjected.count === 0 ? Infinity : sideLimit - toDegrees(rimWide),
    };
  };
  const slack = (targetY: number, distance: number) => {
    const { top, bottom, side } = clearances(targetY, distance);
    return Math.min(top, bottom, side);
  };

  // The closest distance at which everything fits for one target height.
  const lowestDistance = islandRadius * 1.2;
  const highestDistance = islandRadius * 6;
  const closestAt = (targetY: number) => {
    let low = lowestDistance;
    let high = highestDistance;
    if (slack(targetY, high) < 0) return Infinity;
    for (let step = 0; step < BISECTION_STEPS; step += 1) {
      const middle = (low + high) / 2;
      if (slack(targetY, middle) >= 0) high = middle;
      else low = middle;
    }
    return high;
  };

  // A coarse pass over the target heights, then a golden-section search
  // around the best of them.
  let bestHeight = 0;
  let closest = Infinity;
  for (let index = 0; index < COARSE_HEIGHTS; index += 1) {
    const height = MIN_TARGET_Y + (index * (MAX_TARGET_Y - MIN_TARGET_Y)) / (COARSE_HEIGHTS - 1);
    const reach = closestAt(height);
    if (reach < closest) {
      closest = reach;
      bestHeight = height;
    }
  }
  if (Number.isFinite(closest)) {
    const spacing = (MAX_TARGET_Y - MIN_TARGET_Y) / (COARSE_HEIGHTS - 1);
    let low = Math.max(MIN_TARGET_Y, bestHeight - spacing);
    let high = Math.min(MAX_TARGET_Y, bestHeight + spacing);
    let left = high - GOLDEN * (high - low);
    let right = low + GOLDEN * (high - low);
    let leftReach = closestAt(left);
    let rightReach = closestAt(right);
    for (let step = 0; step < REFINE_STEPS; step += 1) {
      if (leftReach <= rightReach) {
        high = right;
        right = left;
        rightReach = leftReach;
        left = high - GOLDEN * (high - low);
        leftReach = closestAt(left);
      } else {
        low = left;
        left = right;
        leftReach = rightReach;
        right = low + GOLDEN * (high - low);
        rightReach = closestAt(right);
      }
    }
    closest = Math.min(closest, leftReach, rightReach);
  } else {
    closest = islandRadius * 4;
  }

  // A little breathing room, then the target height that best centres the
  // content vertically in the clear band at that distance.
  const distance = closest * 1.03;
  let targetY = 0;
  let bestBalance = -Infinity;
  for (let index = 0; index < BALANCE_HEIGHTS; index += 1) {
    const height = MIN_TARGET_Y + index * 0.1;
    const { top, bottom, side } = clearances(height, distance);
    if (side < 0) continue;
    const balance = Math.min(top, bottom);
    if (balance > bestBalance + 1e-9) {
      bestBalance = balance;
      targetY = height;
    }
  }
  const target: Vec3 = [0, round(targetY), 0];
  const position: Vec3 = [
    round(target[0] + pose.back[0] * distance),
    round(target[1] + pose.back[1] * distance),
    round(target[2] + pose.back[2] * distance),
  ];
  return {
    position,
    target,
    minDistance: round(Math.max(8, distance * 0.48)),
    // Zooming out stops short of the cloud ring and the sky dome (radius 54).
    maxDistance: round(Math.max(distance * 1.1, Math.min(distance * 1.3, MAX_ZOOM_OUT))),
    azimuth,
    elevation,
    distance: round(distance),
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Whether two framings put the camera in effectively the same place. */
export function sameFraming(a: CameraFraming, b: CameraFraming, epsilon = 0.05) {
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(a.position[axis] - b.position[axis]) > epsilon) return false;
    if (Math.abs(a.target[axis] - b.target[axis]) > epsilon) return false;
  }
  return true;
}

/**
 * Screen angles (degrees) of a world point from a framing: [horizontal,
 * vertical] off the view axis. Exposed for tests.
 */
export function framingViewAngles(
  framing: CameraFraming,
  point: Vec3,
): [number, number] {
  return viewAngles(
    poseFor(framing.azimuth, framing.elevation),
    framing.target,
    framing.distance,
    point,
  );
}
