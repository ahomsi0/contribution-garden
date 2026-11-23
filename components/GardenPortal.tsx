"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeGardenHandle } from "@/lib/garden-provider";

import "./garden-portal.css";

export default function GardenPortal() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  function openGarden(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const handle = normalizeGardenHandle(username, "github");
    if (!handle) {
      setError("Enter a valid GitHub username.");
      return;
    }
    setOpening(true);
    router.push(`/u/${handle}`);
  }

  return (
    <section className="garden-portal is-landing" aria-labelledby="garden-portal-title">
      <div className="garden-portal__hero">
        <div className="garden-portal__image" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/garden-hero-v5-lush.webp"
            alt=""
            width="1672"
            height="941"
            decoding="async"
            fetchPriority="high"
          />
        </div>
        <div className="garden-portal__veil" aria-hidden="true" />

        <header className="garden-portal__header">
          <div className="garden-portal__brand" aria-label="Contribution Garden home">
            <span className="garden-portal__brand-name">Contribution Garden</span>
            <span className="garden-portal__brand-note">A living code archive</span>
          </div>
          <a className="garden-portal__edition" href="#country-grid-title">
            Top gardeners by country ↓
          </a>
        </header>

        <div className="garden-portal__content">
          <p className="garden-portal__eyebrow">
            <span aria-hidden="true">01</span>
            Your work, made living
          </p>
          <h1 id="garden-portal-title">
            Every contribution leaves <em>something growing.</em>
          </h1>
          <p className="garden-portal__lede">
            See the most active developers in your country as living gardens, or step inside
            anyone&apos;s GitHub history—where streaks become paths and years of work grow into
            landmarks.
          </p>

          <form className="garden-portal__entry" onSubmit={openGarden}>
            <label htmlFor="garden-username">GitHub username</label>
            <div className="garden-portal__entry-row">
              <div className="garden-portal__username">
                <span aria-hidden="true">@</span>
                <input
                  id="garden-username"
                  value={username}
                  placeholder="octocat"
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (error) setError(null);
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={opening}
                />
              </div>
              <button type="submit" disabled={opening}>
                <span>{opening ? "Opening the garden" : "Enter the garden"}</span>
                <span aria-hidden="true">{opening ? "···" : "↗"}</span>
              </button>
            </div>
            {error ? (
              <p className="garden-portal__error" role="alert">
                {error}
              </p>
            ) : (
              <p className="garden-portal__hint">Public contribution history · No sign-in required</p>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}
