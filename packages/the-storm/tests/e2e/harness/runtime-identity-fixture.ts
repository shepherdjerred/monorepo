import { requiredRuntimeSettings } from "#capacity-runtime";
import { thirdPartyPlugins } from "./pins.ts";

const hash = (digit: string) => digit.repeat(64);

/** Synthetic complete identity shared by parser and qualification boundary tests. */
export function runtimeIdentityFixture() {
  return {
    serverImage: `example/java25@sha256:${hash("a")}`,
    imageId: `sha256:${hash("b")}`,
    paperSha256: hash("c"),
    paperRuntimeSha256: hash("d"),
    javaExecutableSha256: hash("e"),
    javaReleaseSha256: hash("f"),
    javaArgumentsSha256: hash("0"),
    heap: { initialBytes: 8 * 1024 ** 3, maxBytes: 8 * 1024 ** 3 },
    plugins: thirdPartyPlugins.map((plugin) => ({
      file: `${plugin.name}-${plugin.version}.jar`,
      sha256: plugin.sha256,
    })),
    settings: requiredRuntimeSettings.map((file) => ({
      file,
      sha256: hash("3"),
    })),
    worldOverrides: { status: "absent", files: [] },
  };
}
