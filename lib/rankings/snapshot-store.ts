import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

export interface SnapshotStore {
  read(pathname: string): Promise<unknown | null>;
  write(pathname: string, data: unknown): Promise<void>;
}

export function directoryStore(root: string): SnapshotStore {
  return {
    async read(pathname) {
      try {
        return JSON.parse(await readFile(path.join(root, pathname), "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async write(pathname, data) {
      const target = path.join(root, pathname);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(data)}\n`);
    },
  };
}

export function blobStore(options: { token: string; baseUrl: string }): SnapshotStore {
  const base = options.baseUrl.replace(/\/+$/, "");
  return {
    async read(pathname) {
      const response = await fetch(`${base}/${pathname}?t=${Date.now()}`, { cache: "no-store" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Blob read failed (${response.status}) for ${pathname}`);
      return response.json();
    },
    async write(pathname, data) {
      await put(pathname, JSON.stringify(data), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 300,
        token: options.token,
      });
    },
  };
}
