import assert from "node:assert/strict";
import test from "node:test";
import { buildTree } from "@/components/garden/world/tree-shapes";

const seeds = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);

test("deciduous trees: tapered trunk, 2-3 branch stubs, 4-6 canopy blobs", () => {
  for (const seed of seeds) {
    const tree = buildTree("deciduous", seed);
    assert.ok(tree.trunk, "has a trunk");
    assert.ok(tree.height >= 2.2 && tree.height <= 3.6, `height ${tree.height}`);
    assert.ok(tree.branches.length >= 2 && tree.branches.length <= 3);
    assert.ok(tree.blobs.length >= 4 && tree.blobs.length <= 6);
    assert.equal(tree.cones.length, 0);
  }
});

test("bare deciduous trees keep branches and only a few small tufts", () => {
  for (const seed of seeds) {
    const leafy = buildTree("deciduous", seed);
    const bare = buildTree("deciduous", seed, { bare: true });
    assert.ok(bare.branches.length > leafy.branches.length);
    assert.ok(bare.blobs.length >= 1 && bare.blobs.length <= 3);
    assert.ok(bare.blobs.every((blob) => blob.tuft));
  }
});

test("evergreens stack 3-4 cones that narrow toward the top", () => {
  for (const seed of seeds) {
    const tree = buildTree("evergreen", seed);
    assert.ok(tree.cones.length >= 3 && tree.cones.length <= 4);
    for (let k = 1; k < tree.cones.length; k += 1) {
      assert.ok(tree.cones[k].y > tree.cones[k - 1].y);
      assert.ok(tree.cones[k].radius < tree.cones[k - 1].radius);
    }
  }
});

test("the great tree has roots, 4 limbs and a wide umbrella of 7-9 large blobs", () => {
  for (const seed of seeds) {
    const tree = buildTree("great", seed);
    const large = tree.blobs.filter((blob) => blob.radius >= 0.9);
    assert.ok(large.length >= 7 && large.length <= 9, `${large.length} large blobs`);
    assert.equal(tree.rootAngles.length, 5);
    assert.ok(tree.limbs.some((limb) => limb.flare), "flared trunk");
    const spread = Math.max(...tree.blobs.map((b) => Math.hypot(b.position[0], b.position[2]) + b.radius));
    const top = Math.max(...tree.blobs.map((b) => b.position[1] + b.radius * b.squash));
    assert.ok(spread * 2 > top * 0.9, "canopy is wide");
    assert.ok(top > 5 && top < 6, `top ${top}`);
  }
});

test("shapes are deterministic per seed", () => {
  assert.deepEqual(buildTree("great", 42), buildTree("great", 42));
  assert.deepEqual(buildTree("deciduous", 42), buildTree("deciduous", 42));
});
