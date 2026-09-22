"use client";

import type { ComponentType, FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  gardenProviderLabel,
  normalizeGardenHandle,
  type GardenProvider,
} from "@/lib/garden-provider";

import "./garden-portal.css";

type PortalPhase = "landing" | "loading" | "garden";

interface InteractiveGardenProps {
  onReady?: () => void;
}

export default function GardenPortal() {
  const [phase, setPhase] = useState<PortalPhase>("landing");
  const [provider, setProvider] = useState<GardenProvider>("github");
  const [username, setUsername] = useState("octocat");
  const [error, setError] = useState<string | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  const [InteractiveGarden, setInteractiveGarden] =
    useState<ComponentType<InteractiveGardenProps> | null>(null);
  const hideHeroTimer = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedProvider: GardenProvider =
      params.get("provider") === "gitlab" ? "gitlab" : "github";
    const requested = normalizeGardenHandle(
      params.get("user") ?? "",
      requestedProvider,
    );
    if (!requested) return;
    const frame = window.requestAnimationFrame(() => {
      setProvider(requestedProvider);
      setUsername(requested);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      if (hideHeroTimer.current !== null) {
        window.clearTimeout(hideHeroTimer.current);
      }
    },
    [],
  );

  async function enterGarden(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (phase === "loading") return;

    const normalized = normalizeGardenHandle(username, provider);
    if (!normalized) {
      setError(`Enter a valid ${gardenProviderLabel(provider)} username.`);
      return;
    }

    setError(null);
    setUsername(normalized);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("user", normalized);
    nextUrl.searchParams.set("provider", provider);
    window.history.replaceState({}, "", nextUrl);
    setPhase("loading");

    try {
      const gardenModule = await import("@/components/ContributionGarden");
      setInteractiveGarden(() => gardenModule.default);
    } catch {
      setPhase("landing");
      setError("The garden could not open. Please try again.");
    }
  }

  const handleGardenReady = useCallback(() => {
    setPhase("garden");
    if (hideHeroTimer.current === null) {
      hideHeroTimer.current = window.setTimeout(() => {
        setHeroVisible(false);
        hideHeroTimer.current = null;
      }, 900);
    }
  }, []);

  function returnToOverview() {
    if (hideHeroTimer.current !== null) {
      window.clearTimeout(hideHeroTimer.current);
      hideHeroTimer.current = null;
    }
    setHeroVisible(true);
    setInteractiveGarden(null);
    setPhase("landing");
  }

  return (
    <main
      className={`garden-portal is-${phase}`}
      data-portal-phase={phase}
      aria-label="Contribution Garden"
    >
      {InteractiveGarden ? (
        <div className="garden-portal__world">
          <InteractiveGarden onReady={handleGardenReady} />
        </div>
      ) : null}

      {heroVisible ? (
        <section
          className="garden-portal__hero"
          aria-labelledby="garden-portal-title"
        >
          <div className="garden-portal__image" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/garden-hero-v4-voxel.webp"
              alt=""
              width="1672"
              height="941"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <div className="garden-portal__veil" aria-hidden="true" />

          <header className="garden-portal__header">
            <div
              className="garden-portal__brand"
              aria-label="Contribution Garden home"
            >
              <span className="garden-portal__brand-name">
                Contribution Garden
              </span>
              <span className="garden-portal__brand-note">
                A living code archive
              </span>
            </div>
            <span className="garden-portal__edition">
              Interactive field study · 2026
            </span>
          </header>

          <div className="garden-portal__content">
            <p className="garden-portal__eyebrow">
              <span aria-hidden="true">01</span>
              Your work, made living
            </p>
            <h1 id="garden-portal-title">
              Every contribution leaves{" "}
              <em>something growing.</em>
            </h1>
            <p className="garden-portal__lede">
              Step inside a walkable world shaped by your {gardenProviderLabel(provider)} history—where
              streaks become paths, repositories take root, and years of work
              grow into landmarks.
            </p>

            <form className="garden-portal__entry" onSubmit={enterGarden}>
              <div className="garden-portal__providers" role="group" aria-label="Contribution source">
                {(["github", "gitlab"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={provider === option ? "is-active" : ""}
                    aria-pressed={provider === option}
                    onClick={() => {
                      setProvider(option);
                      setError(null);
                    }}
                  >
                    {gardenProviderLabel(option)}
                  </button>
                ))}
              </div>
              <label htmlFor="garden-username">
                {gardenProviderLabel(provider)} username
              </label>
              <div className="garden-portal__entry-row">
                <div className="garden-portal__username">
                  <span aria-hidden="true">@</span>
                  <input
                    id="garden-username"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      if (error) setError(null);
                    }}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={phase === "loading"}
                  />
                </div>
                <button type="submit" disabled={phase === "loading"}>
                  <span>
                    {phase === "loading"
                      ? "Growing your world"
                      : "Enter the garden"}
                  </span>
                  <span aria-hidden="true">
                    {phase === "loading" ? "···" : "↗"}
                  </span>
                </button>
              </div>
              {error ? (
                <p className="garden-portal__error" role="alert">
                  {error}
                </p>
              ) : (
                <p className="garden-portal__hint">
                  Public contribution history · No sign-in required
                </p>
              )}
            </form>
          </div>

          <div
            className="garden-portal__legend"
            role="group"
            aria-label="How the garden grows"
          >
            <div>
              <span>Contributions</span>
              <strong>Wildflowers</strong>
            </div>
            <div>
              <span>Streaks</span>
              <strong>Winding paths</strong>
            </div>
            <div>
              <span>Years</span>
              <strong>Old growth</strong>
            </div>
          </div>

          {phase === "loading" ? (
            <div className="garden-portal__loading-line" aria-hidden="true">
              <span />
            </div>
          ) : null}
        </section>
      ) : null}

      {phase === "garden" ? (
        <button
          className="garden-portal__overview"
          type="button"
          onClick={returnToOverview}
        >
          <span aria-hidden="true">←</span>
          Overview
        </button>
      ) : null}
    </main>
  );
}
