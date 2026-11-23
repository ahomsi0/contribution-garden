import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Board } from "@/components/leaderboard/Board";
import { boardScaleMax } from "@/lib/rankings/bed-scale";
import { findCountry } from "@/lib/rankings/countries";
import { formatUpdated, isStale } from "@/lib/rankings/format";
import { getCountrySnapshot } from "@/lib/rankings/store";
import "@/components/leaderboard/leaderboard.css";

export const dynamic = "force-dynamic";

interface CountryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CountryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const country = findCountry(slug);
  if (!country) return { title: "Country not found" };
  return {
    title: `Top gardeners in ${country.name}`,
    alternates: { canonical: `/country/${slug}` },
  };
}

export default async function CountryPage({ params }: CountryPageProps) {
  const { slug } = await params;
  const country = findCountry(slug);
  if (!country) notFound();

  const snapshot = await getCountrySnapshot(country.slug);
  const now = new Date();

  return (
    <main className="board-page">
      <div className="board-page__inner">
        <Link className="board-page__back" href="/">
          ← All countries
        </Link>
        <h1>{country.name}</h1>
        {snapshot ? (
          <>
            <p className="board-page__meta">
              {snapshot.users.length} gardeners · {formatUpdated(snapshot.generatedAt, now)}
            </p>
            {isStale(snapshot.generatedAt, now) ? (
              <p className="board-page__stale">This board hasn&apos;t refreshed in over two days.</p>
            ) : null}
            <Board slug={country.slug} users={snapshot.users} scaleMax={boardScaleMax(snapshot.users)} />
          </>
        ) : (
          <p className="board-page__empty">This board is being planted. Check back tomorrow.</p>
        )}
      </div>
    </main>
  );
}
