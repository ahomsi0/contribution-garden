"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCount } from "@/lib/rankings/format";
import type { RankedUser } from "@/lib/rankings/snapshot";
import { YearBeds } from "./YearBeds";

export interface BoardProps {
  slug: string;
  users: RankedUser[];
  scaleMax: number;
}

export function Board({ slug, users, scaleMax }: BoardProps) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (user) =>
        user.login.toLowerCase().includes(needle) ||
        (user.name ?? "").toLowerCase().includes(needle),
    );
  }, [filter, users]);

  return (
    <section className="board" aria-label="Ranked gardeners">
      <input
        className="board__filter"
        type="search"
        placeholder="Filter by username"
        aria-label="Filter by username"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {visible.length === 0 ? (
        <p className="board__empty">No gardeners match &lsquo;{filter.trim()}&rsquo;.</p>
      ) : (
        <ol className="board__list">
          {visible.map((user) => (
            <li key={user.id}>
              <Link className="board__row" href={`/u/${user.login}?from=${slug}`}>
                <span className="board__rank">{user.rank}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="board__avatar" src={`${user.avatarUrl}&s=64`} alt="" width={32} height={32} loading="lazy" />
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
