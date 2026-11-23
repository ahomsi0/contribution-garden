"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { GardenProvider } from "@/lib/garden-provider";

const ContributionGarden = dynamic(() => import("@/components/ContributionGarden"), {
  ssr: false,
  loading: () => <div className="garden-route-loading" aria-hidden="true" />,
});

export interface GardenRouteProps {
  login: string;
  provider: GardenProvider;
  backHref: string;
  backLabel: string;
}

export default function GardenRoute({ login, provider, backHref, backLabel }: GardenRouteProps) {
  return (
    <>
      <ContributionGarden initialLogin={login} initialProvider={provider} />
      <Link className="garden-back-link" href={backHref}>
        <span aria-hidden="true">←</span> {backLabel}
      </Link>
    </>
  );
}
