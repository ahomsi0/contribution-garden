import Link from "next/link";
import { COUNTRIES } from "@/lib/rankings/countries";
import { formatCount, formatUpdated } from "@/lib/rankings/format";
import type { RankingsIndex } from "@/lib/rankings/snapshot";

export function CountryGrid({ index }: { index: RankingsIndex | null }) {
  const entries = new Map(index?.countries.map((entry) => [entry.slug, entry]));
  const now = new Date();
  return (
    <section className="country-grid" aria-labelledby="country-grid-title">
      <h2 id="country-grid-title">Explore gardens by country</h2>
      <ul>
        {COUNTRIES.map((country) => {
          const entry = entries.get(country.slug);
          return (
            <li key={country.slug}>
              <Link className="country-card" href={`/country/${country.slug}`}>
                <strong>{country.name}</strong>
                {entry?.leader ? (
                  <span className="country-card__leader">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${entry.leader.avatarUrl}&s=48`} alt="" width={24} height={24} loading="lazy" />
                    @{entry.leader.login} · {formatCount(entry.leader.score)}
                  </span>
                ) : (
                  <span className="country-card__leader">Being planted</span>
                )}
                <small>
                  {entry ? `${entry.userCount} gardeners · ${formatUpdated(entry.updatedAt, now)}` : "No board yet"}
                </small>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
