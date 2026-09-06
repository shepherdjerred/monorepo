import {
  parseDesiredManifest,
  reconcileFreshRss,
  type ReconcileResult,
} from "./freshrss-reconciler.ts";

export type FreshRssActivities = {
  runFreshRssSync: () => Promise<ReconcileResult>;
};

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function requiredFile(path: string, name: string): Promise<string> {
  const value = await Bun.file(path).text();
  if (value.length === 0) {
    throw new Error(`${name} is empty`);
  }
  return value;
}

export async function runFreshRssSync(): Promise<ReconcileResult> {
  const manifestValue: unknown = JSON.parse(
    await requiredFile(
      requiredEnv("FRESHRSS_MANIFEST_PATH"),
      "FRESHRSS_MANIFEST_PATH",
    ),
  );
  return reconcileFreshRss({
    apiUrl: requiredEnv("FRESHRSS_API_URL"),
    user: requiredEnv("FRESHRSS_USER"),
    password: await requiredFile(
      requiredEnv("FRESHRSS_API_PASSWORD_FILE"),
      "FRESHRSS_API_PASSWORD_FILE",
    ),
    category: requiredEnv("FRESHRSS_CATEGORY"),
    manifest: parseDesiredManifest(manifestValue),
  });
}

export const freshrssActivities = {
  runFreshRssSync,
} satisfies FreshRssActivities;
