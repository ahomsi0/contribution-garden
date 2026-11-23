import type { Metadata } from "next";
import GardenRoute from "@/components/GardenRoute";
import NotGrowing from "@/components/NotGrowing";
import { normalizeGardenHandle } from "@/lib/garden-provider";

export const dynamic = "force-dynamic";

interface GitlabPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function resolve({ searchParams }: GitlabPageProps) {
  const query = await searchParams;
  return typeof query.user === "string" ? normalizeGardenHandle(query.user, "gitlab") : null;
}

export async function generateMetadata(props: GitlabPageProps): Promise<Metadata> {
  const handle = await resolve(props);
  return { title: handle ? `@${handle}'s garden` : "Garden not found" };
}

export default async function GitlabGardenPage(props: GitlabPageProps) {
  const handle = await resolve(props);
  // Do not call notFound() here: vinext's pre-render probe invokes the page with
  // empty searchParams, which would turn every valid request into a 404.
  if (!handle) return <NotGrowing message="That GitLab gardener doesn't exist." />;
  return <GardenRoute login={handle} provider="gitlab" backHref="/" backLabel="Home" />;
}
