import { redirect } from "next/navigation";
import GardenPortal from "@/components/GardenPortal";
import { CountryGrid } from "@/components/leaderboard/CountryGrid";
import { normalizeGardenHandle } from "@/lib/garden-provider";
import { getRankingsIndex } from "@/lib/rankings/store";
import "@/components/leaderboard/leaderboard.css";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  if (typeof params.user === "string") {
    const provider = params.provider === "gitlab" ? "gitlab" : "github";
    const handle = normalizeGardenHandle(params.user, provider);
    if (handle) redirect(provider === "gitlab" ? `/u/${handle}?provider=gitlab` : `/u/${handle}`);
  }

  const index = await getRankingsIndex();
  return (
    <main>
      <GardenPortal />
      <CountryGrid index={index} />
    </main>
  );
}
