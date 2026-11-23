"use client";

import { Bird, ChevronDown, Flower2, Sparkles, Sprout, TreeDeciduous, Trees, Waves } from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import type { GardenProvider } from "@/lib/garden-provider";

const LEGEND_STORAGE_KEY = "cg-legend-open";

const legendRows: Array<{
  key: string;
  icon: typeof Sprout;
  label: string;
  text: string;
  gitlabText?: string;
}> = [
  { key: "trees", icon: Trees, label: "Trees", text: "one per year, sized by that year's contributions" },
  { key: "great", icon: TreeDeciduous, label: "Great tree", text: "your lifetime total" },
  { key: "meadow", icon: Sprout, label: "Meadow", text: "every day you contributed; denser is more" },
  {
    key: "flowers",
    icon: Flower2,
    label: "Wildflowers",
    text: "pull requests and issues this past year",
    gitlabText: "not available on GitLab",
  },
  { key: "wildlife", icon: Bird, label: "Butterflies and birds", text: "recent activity" },
  { key: "fireflies", icon: Sparkles, label: "Fireflies", text: "a streak of 30+ days" },
  { key: "pond", icon: Waves, label: "Pond", text: "public repositories" },
];

export function GardenLegend({ provider = "github" }: { provider?: GardenProvider }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let next: boolean | null = null;
    try {
      const stored = window.localStorage.getItem(LEGEND_STORAGE_KEY);
      if (stored === "1") next = true;
      else if (stored === "0") next = false;
    } catch {
      // Storage can be unavailable; fall back to the viewport default.
    }
    if (next === null) next = window.matchMedia("(min-width: 931px)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(next);
  }, []);

  // The browser opens and closes the details itself; this mirrors it. A
  // toggle that only echoes our own `open` (the stored or viewport default
  // applied on mount) is not the reader's choice, so it isn't saved.
  const toggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (next === open) return;
    setOpen(next);
    try {
      window.localStorage.setItem(LEGEND_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  };

  return (
    <details className="cg-legend" open={open} onToggle={toggle}>
      <summary>
        <span>Reading the garden</span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <ul>
        {legendRows.map(({ key, icon: Icon, label, text, gitlabText }) => (
          <li key={key} className="cg-legend-row">
            <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
            <span>
              <strong>{label}</strong>: {provider === "gitlab" && gitlabText ? gitlabText : text}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
