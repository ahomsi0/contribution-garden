import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GardenRoute from "@/components/GardenRoute";
import { normalizeGardenHandle, type GardenProvider } from "@/lib/garden-provider";
import { findCountry } from "@/lib/rankings/countries";

interface UserPageProps {
  params: Promise<{ login: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function resolve({ params, searchParams }: UserPageProps) {
  const [{ login }, query] = await Promise.all([params, searchParams]);
  const provider: GardenProvider = query.provider === "gitlab" ? "gitlab" : "github";
  const handle = normalizeGardenHandle(decodeURIComponent(login), provider);
  const from = typeof query.from === "string" ? findCountry(query.from) : undefined;
  return { handle, provider, from };
}

export async function generateMetadata(props: UserPageProps): Promise<Metadata> {
  const { handle } = await resolve(props);
  return { title: handle ? `@${handle}'s garden` : "Garden not found" };
}

export default async function UserGardenPage(props: UserPageProps) {
  const { handle, provider, from } = await resolve(props);
  if (!handle) notFound();
  return (
    <GardenRoute
      login={handle}
      provider={provider}
      backHref={from ? `/country/${from.slug}` : "/"}
      backLabel={from ? from.name : "Home"}
    />
  );
}
