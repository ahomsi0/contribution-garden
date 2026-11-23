import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_FOV,
  cameraFraming,
  type CameraFraming,
  framingViewAngles,
  GREAT_TREE_TOP,
  sameFraming,
  type Vec3,
} from "@/components/garden/world/camera";
import { GREAT_TREE_POSITION } from "@/components/garden/world/mapping";

const DEG = Math.PI / 180;
/** The top bar and weather switch end about 16° above the view axis. */
const UI_BAND = 16;
const WATERFALL = 145 * DEG;
/** Ground at the great tree is a little below y = 0. */
const GROUND = -0.6;

const small = { radius: 9, top: GROUND + GREAT_TREE_TOP * 0.9 };
const large = { radius: 13, top: GROUND + GREAT_TREE_TOP * 2.1 };

function crownPoints(top: number): Vec3[] {
  const { x, z } = GREAT_TREE_POSITION;
  const reach = top * 0.5;
  const points: Vec3[] = [[x, top, z]];
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    points.push([x + Math.cos(angle) * reach, top - 0.3 * reach, z + Math.sin(angle) * reach]);
  }
  return points;
}

function rimPoints(radius: number): Vec3[] {
  return Array.from({ length: 64 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    return [Math.cos(angle) * radius, -0.6, Math.sin(angle) * radius] as Vec3;
  });
}

function assertFits(framing: CameraFraming, radius: number, top: number, aspect = 1.6) {
  const halfHeight = CAMERA_FOV / 2;
  const halfWidth = Math.atan(Math.tan(halfHeight * DEG) * aspect) / DEG;
  for (const point of crownPoints(top)) {
    const [, vertical] = framingViewAngles(framing, point);
    assert.ok(
      vertical < UI_BAND,
      `crown point at ${vertical.toFixed(2)}° reaches the UI band (${UI_BAND}°)`,
    );
  }
  for (const point of rimPoints(radius)) {
    const [horizontal, vertical] = framingViewAngles(framing, point);
    assert.ok(Math.abs(horizontal) < halfWidth, `rim off the side: ${horizontal.toFixed(2)}°`);
    assert.ok(vertical > -halfHeight, `rim below the frame: ${vertical.toFixed(2)}°`);
    assert.ok(vertical < UI_BAND, `rim under the UI band: ${vertical.toFixed(2)}°`);
  }
}

function elevationOf(framing: CameraFraming) {
  const dx = framing.position[0] - framing.target[0];
  const dy = framing.position[1] - framing.target[1];
  const dz = framing.position[2] - framing.target[2];
  return Math.atan2(dy, Math.hypot(dx, dz)) / DEG;
}

function azimuthGap(framing: CameraFraming, waterfall: number) {
  const dx = framing.position[0] - framing.target[0];
  const dz = framing.position[2] - framing.target[2];
  const camera = Math.atan2(dz, dx);
  const gap = Math.abs(((camera - waterfall + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return gap / DEG;
}

test("a radius-9 island with a small great tree fits below the UI band", () => {
  const framing = cameraFraming(small.radius, small.top, WATERFALL);
  assertFits(framing, small.radius, small.top);
});

test("a radius-13 island with a full-grown (2.1 scale) great tree fits below the UI band", () => {
  const framing = cameraFraming(large.radius, large.top, WATERFALL);
  assertFits(framing, large.radius, large.top);
});

test("the fit accounts for the field of view and aspect ratio", () => {
  for (const fov of [36, 42, 50]) {
    const halfTan = Math.tan((fov / 2) * DEG);
    // The UI covers the top 12% of the frame whatever the fov.
    const band = Math.atan(0.76 * halfTan) / DEG;
    for (const aspect of [0.75, 1.6, 2.2]) {
      const framing = cameraFraming(large.radius, large.top, WATERFALL, { fov, aspect });
      const halfWidth = Math.atan(halfTan * aspect) / DEG;
      for (const point of crownPoints(large.top)) {
        assert.ok(framingViewAngles(framing, point)[1] < band, `fov ${fov}, aspect ${aspect}`);
      }
      for (const point of rimPoints(large.radius)) {
        assert.ok(Math.abs(framingViewAngles(framing, point)[0]) < halfWidth);
      }
    }
  }
});

test("bigger islands and taller trees frame from further away", () => {
  const near = cameraFraming(small.radius, small.top, WATERFALL);
  const far = cameraFraming(large.radius, large.top, WATERFALL);
  assert.ok(far.distance > near.distance);
  assert.ok(near.minDistance < near.distance && near.distance < near.maxDistance);
  assert.ok(far.minDistance < far.distance && far.distance < far.maxDistance);
});

test("the camera sits 30-45° of azimuth off the waterfall at a 30-35° elevation", () => {
  for (const degrees of [0, 10, 145, 160, 200, 350]) {
    const waterfall = degrees * DEG;
    for (const size of [small, large]) {
      const framing = cameraFraming(size.radius, size.top, waterfall);
      const gap = azimuthGap(framing, waterfall);
      assert.ok(gap >= 30 && gap <= 45, `waterfall ${gap.toFixed(1)}° off the view axis`);
      const elevation = elevationOf(framing);
      assert.ok(elevation >= 30 && elevation <= 35, `elevation ${elevation.toFixed(1)}°`);
    }
  }
});

test("the waterfall shows on the right of the frame, clear of the stats panel", () => {
  for (const degrees of [0, 10, 145, 160, 200, 350]) {
    const waterfall = degrees * DEG;
    for (const size of [small, large]) {
      const framing = cameraFraming(size.radius, size.top, waterfall);
      const rim: Vec3 = [
        Math.cos(waterfall) * size.radius,
        GROUND,
        Math.sin(waterfall) * size.radius,
      ];
      const [horizontal] = framingViewAngles(framing, rim);
      assert.ok(horizontal > 5, `waterfall at ${horizontal.toFixed(1)}° (left of centre)`);
    }
  }
});

test("the same inputs give the same framing; different inputs move it", () => {
  const a = cameraFraming(11, 7, WATERFALL);
  const b = cameraFraming(11, 7, WATERFALL);
  const c = cameraFraming(12.5, 9, WATERFALL);
  assert.ok(sameFraming(a, b));
  assert.ok(!sameFraming(a, c));
});

test("a tall phone frame crops the island's sides instead of zooming far out", () => {
  const desktop = cameraFraming(large.radius, large.top, WATERFALL, { aspect: 1.6 });
  const phone = cameraFraming(large.radius, large.top, WATERFALL, { aspect: 375 / 812 });
  const narrow = cameraFraming(large.radius, large.top, WATERFALL, { aspect: 0.7 });
  assert.equal(phone.distance, narrow.distance);
  assert.ok(phone.distance < desktop.distance * 1.5, `phone distance ${phone.distance}`);
});
