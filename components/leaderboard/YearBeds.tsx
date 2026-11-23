import { stemValue } from "@/lib/rankings/bed-scale";
import { formatCount } from "@/lib/rankings/format";
import type { YearMonths } from "@/lib/rankings/snapshot";

const GREENS = ["#C0DD97", "#97C459", "#639922", "#3B6D11"] as const;
const FLOWERS = ["#ED93B1", "#EF9F27", "#7F77DD"] as const;
const SOIL = "#888780";

const WIDTH = 420;
const HEIGHT = 56;
const GROUND = HEIGHT - 8;
const MAX_STEM = GROUND - 6;
const GAP = 4;
const PAD = 5;
const MAX_BED = 36;

export interface YearBedsProps {
  years: readonly YearMonths[];
  scaleMax: number;
  className?: string;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const round = (value: number) => Math.round(value * 100) / 100;

export function YearBeds({ years, scaleMax, className }: YearBedsProps) {
  const total = years.reduce((acc, year) => acc + sum(year.months), 0);
  const label =
    years.length === 0
      ? "No contributions yet"
      : `${years[0].year}–${years[years.length - 1].year}: ${formatCount(total)} contributions`;
  const count = Math.max(1, years.length);
  const bedWidth = Math.min(MAX_BED, (WIDTH - PAD * 2 - GAP * (count - 1)) / count);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      className={className}
      preserveAspectRatio="xMinYMid meet"
    >
      {years.map((year, yearIndex) => {
        const x0 = PAD + yearIndex * (bedWidth + GAP);
        const values = year.months.map((value) => stemValue(value, scaleMax));
        const peak = values.indexOf(Math.max(...values));
        return (
          <g key={year.year}>
            <title>{`${year.year} · ${formatCount(sum(year.months))} contributions`}</title>
            <rect x={round(x0)} y={GROUND} width={round(bedWidth)} height={6} rx={2} fill={SOIL} />
            {values.map((value, month) => {
              if (value <= 0) return null;
              const x = x0 + 1.5 + (month * (bedWidth - 3)) / 11;
              const top = GROUND - (3 + value * (MAX_STEM - 3));
              return (
                <line
                  key={month}
                  x1={round(x)}
                  y1={GROUND}
                  x2={round(x)}
                  y2={round(top)}
                  stroke={GREENS[Math.min(3, Math.floor(value * 4))]}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              );
            })}
            {values[peak] > 0.5 ? (
              <circle
                cx={round(x0 + 1.5 + (peak * (bedWidth - 3)) / 11)}
                cy={round(GROUND - (3 + values[peak] * (MAX_STEM - 3)))}
                r={2.4}
                fill={FLOWERS[yearIndex % FLOWERS.length]}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
