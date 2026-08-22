import type { GardenQuality } from "@/components/garden/types";

/**
 * Picks a render quality tier from cheap, one-time device signals so capable
 * desktops get sharper output while touch/low-core devices stay light.
 */
export function detectGardenQuality(): GardenQuality {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "medium";
  }

  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;

  if (coarsePointer || cores <= 4 || (memory !== undefined && memory <= 4)) {
    return "low";
  }
  if (cores >= 8 && (memory === undefined || memory >= 8)) {
    return "high";
  }
  return "medium";
}
