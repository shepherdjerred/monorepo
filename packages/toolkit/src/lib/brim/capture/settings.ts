import {
  loadToolkitConfig,
  type ToolkitConfigOptions,
} from "#lib/toolkit-config.ts";
import { captureCli, type CaptureCli } from "./clis.ts";

export type BrimCaptureSettings = {
  readonly enabled: boolean;
  readonly port: number;
  readonly retentionDays: number;
  /** The wrapped CLIs, in table order. */
  readonly clis: readonly CaptureCli[];
};

export async function loadBrimCaptureSettings(
  options: ToolkitConfigOptions = {},
): Promise<BrimCaptureSettings> {
  const config = await loadToolkitConfig(options);
  const names = new Set(await config.value("brimCaptureClis"));
  const clis = [...names].map((name) => {
    const cli = captureCli(name);
    if (cli === undefined) {
      throw new Error(`brim.capture.clis names an unknown CLI: ${name}`);
    }
    return cli;
  });
  return {
    enabled: await config.value("brimCaptureEnabled"),
    port: await config.value("brimCapturePort"),
    retentionDays: await config.value("brimCaptureRetentionDays"),
    clis,
  };
}
