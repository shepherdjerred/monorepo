import type { Actor } from "@shepherdjerred/artifacts/contract";
import { detectArtifactsActor } from "#lib/artifacts/actor.ts";
import {
  createArtifactsClient,
  type ArtifactsClient,
} from "#lib/artifacts/client.ts";
import type { UploadRuntime } from "#lib/artifacts/upload.ts";
import type { WaitOptions } from "#lib/artifacts/wait.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";

/** Where a command writes. Stdout resolves once the bytes are flushed. */
export type Io = {
  stdout: (text: string) => Promise<void>;
  stderr: (text: string) => void;
};

export const processIo: Io = {
  stdout: (text) =>
    new Promise<void>((resolve, reject) => {
      process.stdout.write(text, (error) => {
        if (error === null || error === undefined) resolve();
        else reject(error);
      });
    }),
  stderr: (text) => {
    process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
  },
};

export type ConnectOptions = {
  url?: string | undefined;
  /** Mutations and waits need an identity; reads send one only when available. */
  actor: "required" | "optional";
};

/** Everything a command touches outside its arguments, so tests can replace it. */
export type Runtime = {
  io: Io;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  /** The worktree or directory used to name default boards. */
  workspace: string;
  connect: (options: ConnectOptions) => Promise<ArtifactsClient>;
  stdin: () => Promise<string>;
  /** Aborted by SIGINT or SIGTERM. */
  signal?: AbortSignal | undefined;
  /** 130 or 143, whichever signal arrived. */
  interruptExit?: (() => number) | undefined;
  /** Test overrides for the wait loop and uploads. */
  wait?: Partial<WaitOptions> | undefined;
  upload?: UploadRuntime | undefined;
};

/** Reads send an identity when one can be detected; writes need it. */
async function resolveActor(
  need: ConnectOptions["actor"],
  name: string,
): Promise<Actor | null> {
  try {
    return await detectArtifactsActor(Bun.env, name);
  } catch (error) {
    if (need === "required") throw error;
    return null;
  }
}

export async function defaultConnect(
  options: ConnectOptions,
): Promise<ArtifactsClient> {
  const config = await loadToolkitConfig();
  const baseUrl = options.url ?? (await config.value("artifactsUrl"));
  const name = await config.value("trackerActorName");
  return createArtifactsClient({
    baseUrl,
    actor: await resolveActor(options.actor, name),
  });
}

export function defaultRuntime(
  extra: Pick<Runtime, "signal" | "interruptExit"> = {},
): Runtime {
  return {
    io: processIo,
    env: Bun.env,
    now: () => new Date(),
    workspace: process.cwd(),
    connect: defaultConnect,
    stdin: () => Bun.stdin.text(),
    ...extra,
  };
}
