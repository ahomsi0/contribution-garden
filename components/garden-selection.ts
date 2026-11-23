import type { GardenSelection } from "@/components/garden/types";
import type { GardenEntity } from "@/components/ui";
import type { SelectedGardenEntity } from "@/lib/garden-store";

const DEFAULT_ACCENT: Record<GardenEntity["kind"], string> = {
  flower: "#dfad64",
  tree: "#98aa73",
  water: "#9bc8c2",
  plant: "#d7e5a4",
  wildlife: "#d7e5a4",
  landmark: "#d7e5a4",
};

/** What the store keeps of a selection in the 3D scene. */
export function selectionForUI(selection: GardenSelection | null): SelectedGardenEntity | null {
  if (!selection) return null;

  const kind = selection.kind === "contribution" ? "day" : selection.kind;

  return {
    id: selection.id,
    kind,
    title: selection.title,
    subtitle: selection.subtitle ?? selection.kind,
    description: selection.description,
    date: selection.date,
    // A flower stands for pull requests and issues, not contributions, so it
    // carries no contribution count; its detail rows give the real numbers.
    count: selection.kind === "flower" ? undefined : selection.count,
    repositories: selection.repositories,
    accent: selection.accent,
    worldPosition: selection.worldPosition,
    details: selection.details.map(({ label, value }) => ({
      label,
      value: typeof value === "number" ? value.toLocaleString() : value,
    })),
  };
}

/**
 * The specimen card's view of a stored selection. Detail rows become facts;
 * the card's own date, repository and contribution rows are left out when a
 * fact already says the same thing.
 */
export function entityForUI(
  selected: SelectedGardenEntity | null,
  activity: number,
): GardenEntity | null {
  if (!selected) return null;
  const kind: GardenEntity["kind"] =
    selected.kind === "day"
      ? "plant"
      : selected.kind === "achievement"
        ? "landmark"
        : selected.kind === "water" ||
            selected.kind === "wildlife" ||
            selected.kind === "tree" ||
            selected.kind === "flower"
          ? selected.kind
          : "plant";
  const details = selected.details ?? [];
  const has = (pattern: RegExp) => details.some((detail) => pattern.test(detail.label));
  const facts = details.filter(
    (detail) => !(selected.date && /^date$/i.test(detail.label)),
  );
  return {
    id: selected.id,
    kind,
    eyebrow: selected.subtitle,
    title: selected.title,
    description: selected.description,
    date: selected.date,
    contributionCount:
      kind === "flower" || has(/contributions|commits/i) ? undefined : selected.count,
    repository: has(/^repositor/i) ? undefined : selected.repositories?.[0],
    status: activity > 0.7 ? "Thriving" : activity > 0.4 ? "Growing" : "Resting",
    facts: facts.length > 0 ? facts : undefined,
    accent: selected.accent ?? DEFAULT_ACCENT[kind],
  };
}
