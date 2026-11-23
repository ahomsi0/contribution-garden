"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { avatarAt, formatCount } from "@/lib/rankings/format";
import type { RankedUser } from "@/lib/rankings/snapshot";
import { YearBeds } from "./YearBeds";

export interface BoardProps {
  slug: string;
  users: RankedUser[];
  scaleMax: number;
}

export function Board({ slug, users, scaleMax }: BoardProps) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const visible = useMemo(() => {
    const needle = deferredFilter.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (user) =>
        user.login.toLowerCase().includes(needle) ||
        (user.name ?? "").toLowerCase().includes(needle),
    );
  }, [deferredFilter, users]);

  return (
    <section className="board" aria-label="Ranked gardeners">
      <input
        className="board__filter"
        type="search"
        placeholder="Filter by name"
        aria-label="Filter by name"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <p className="sr-only" aria-live="polite">
        {`${visible.length} of ${users.length} gardeners`}
      </p>
      {visible.length === 0 ? (
        <p className="board__empty">No gardeners match &lsquo;{filter.trim()}&rsquo;.</p>
      ) : (
        <ol className="board__list">
          {visible.map((user) => (
            <li key={user.id}>
              <Link className="board__row" href={`/u/${user.login}?from=${slug}`}>
                <span className="board__rank">{user.rank}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="board__avatar" src={avatarAt(user.avatarUrl, 64)} alt="" width={32} height={32} loading="lazy" />
                <span className="board__name">
                  {user.name ?? user.login}
                  <small>@{user.login}</small>
                </span>
                <span className="board__score">
                  {formatCount(user.score)}
                  <small>lifetime</small>
                </span>
                <YearBeds className="board__beds" years={user.years} scaleMax={scaleMax} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
