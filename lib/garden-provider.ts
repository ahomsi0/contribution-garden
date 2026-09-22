export type GardenProvider = "github" | "gitlab";

export function normalizeGardenHandle(
  value: string,
  provider: GardenProvider,
): string | null {
  const handle = value.trim().replace(/^@/, "");
  if (provider === "gitlab") {
    return /^[a-z\d](?:[a-z\d._-]{0,253}[a-z\d])?$/i.test(handle)
      ? handle.toLowerCase()
      : null;
  }
  return /^(?!-)[a-zA-Z0-9-]{1,39}(?<!-)$/.test(handle)
    ? handle.toLowerCase()
    : null;
}

export function gardenProviderLabel(provider: GardenProvider): string {
  return provider === "gitlab" ? "GitLab" : "GitHub";
}
