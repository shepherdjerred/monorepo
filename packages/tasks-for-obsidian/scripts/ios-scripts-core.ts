import { lstat } from "node:fs/promises";
import { z } from "zod";

const ErrorCodeSchema = z.looseObject({ code: z.unknown() });

export function cleanTargets(packageRoot: string): readonly [string, string] {
  return [`${packageRoot}/ios/build`, `${packageRoot}/ios/Pods`];
}

function isMissingPath(error: unknown): boolean {
  const parsed = ErrorCodeSchema.safeParse(error);
  return parsed.success && parsed.data.code === "ENOENT";
}

export async function derivedDataTargets(home: string): Promise<string[]> {
  const derivedData = `${home}/Library/Developer/Xcode/DerivedData`;
  try {
    await lstat(derivedData);
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
  return [
    ...new Bun.Glob("TasksForObsidian-*").scanSync({
      cwd: derivedData,
      absolute: true,
      onlyFiles: false,
    }),
  ];
}

export function outputPath(argument?: string): string {
  return argument ?? "/tmp/device.log";
}
