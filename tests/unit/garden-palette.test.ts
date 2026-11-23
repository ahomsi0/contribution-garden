import assert from "node:assert/strict";
import test from "node:test";
import { worldPalette, type WorldPalette } from "@/components/garden/world/palette";
import type { GardenSeason, GardenTimeOfDay } from "@/components/garden/types";

const seasons: GardenSeason[] = ["spring", "summer", "autumn", "winter"];
const times: GardenTimeOfDay[] = ["morning", "day", "sunset", "night"];
const HEX = /^#[0-9a-f]{6}$/i;

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function colourStrings(p: WorldPalette): string[] {
  const out: string[] = [];
  for (const v of Object.values(p)) {
    if (typeof v === "string") {
      if (v.startsWith("#")) out.push(v);
    } else if (Array.isArray(v)) out.push(...(v as string[]));
  }
  return out;
}

test("every colour is a 6-digit hex across all 16 combinations", () => {
  for (const s of seasons) {
    for (const t of times) {
      const p = worldPalette(s, t);
      const colours = colourStrings(p);
      assert.ok(colours.length > 20);
      for (const c of colours) assert.match(c, HEX, `${s}/${t}: ${c}`);
    }
  }
});

test("summer foliage is saturated green", () => {
  for (const c of worldPalette("summer", "day").foliage) {
    const { h, s } = hexToHsl(c);
    assert.ok(s >= 0.35, `${c} saturation ${s}`);
    assert.ok(h >= 80 && h <= 140, `${c} hue ${h}`);
  }
});

test("autumn foliage is warm", () => {
  const warm = worldPalette("autumn", "day").foliage.filter((c) => {
    const { h } = hexToHsl(c);
    return h >= 0 && h <= 50;
  });
  assert.ok(warm.length >= 3);
});

test("snow and bare trees are winter only", () => {
  for (const s of seasons) {
    const p = worldPalette(s, "day");
    assert.equal(p.snow !== null, s === "winter");
    assert.equal(p.bareDeciduous, s === "winter");
  }
});

test("blossom is spring only", () => {
  for (const s of seasons) {
    assert.equal(worldPalette(s, "day").blossom !== null, s === "spring");
  }
});

test("sunset sun is golden-orange", () => {
  const { h } = hexToHsl(worldPalette("summer", "sunset").sun);
  assert.ok(h >= 15 && h <= 45, `hue ${h}`);
});

test("night is dim", () => {
  for (const s of seasons) assert.ok(worldPalette(s, "night").sunIntensity < 1);
});
