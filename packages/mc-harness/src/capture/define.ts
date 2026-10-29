import type { Box } from "#protocol/bridge.ts";
import type { ClientState } from "#protocol/client.ts";
import type { ClientAction } from "#protocol/client.ts";
import type { Presentation } from "#protocol/media.ts";
import type { CaptureResource } from "#protocol/capture.ts";

export type Cleanup =
  | ({ kind: "resource" } & CaptureResource)
  | { kind: "command"; command: string }
  | {
      kind: "player-command";
      command: string;
      expectedMessage: string;
      standing: [number, number, number];
      look: [number, number, number];
    }
  | {
      kind: "break";
      sneak?: boolean;
      position: [number, number, number];
      standing: [number, number, number];
    };

export type CaptureScene = {
  name: string;
  description: string;
  /** Relative to the selected site's anchor, including ground and swept/physics effects. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  inspectors: string[];
  staging: [number, number, number];
  setup: (context: CaptureContext) => Promise<void>;
  run: (context: CaptureContext) => Promise<void>;
};

export type CaptureContext = {
  id: string;
  target: string;
  name: string;
  box: Box;
  at: (x: number, y: number, z: number) => [number, number, number];
  status: () => Promise<ClientState>;
  waitFor: (
    description: string,
    predicate: (state: ClientState) => boolean,
    timeoutMs?: number,
  ) => Promise<ClientState>;
  step: (name: string, action: () => Promise<void>) => Promise<void>;
  command: (text: string) => Promise<void>;
  shopAccess: (enabled: boolean) => Promise<void>;
  playerCommand: (text: string, expectedMessage: string) => Promise<void>;
  feedback: (expectedMessage: string) => Promise<void>;
  block: (position: [number, number, number]) => Promise<string>;
  inspect: () => Promise<Record<string, string>>;
  track: (
    track: "mechanic" | "shopkeeper" | "governor" | "spellcaster" | "engineer",
    level: number,
  ) => Promise<void>;
  action: (
    action: ClientAction,
    args?: Record<string, unknown>,
  ) => Promise<unknown>;
  /** Persists compensation before dispatching a setup command. */
  prepare: (text: string, cleanup: Cleanup) => Promise<void>;
  defer: (cleanup: Cleanup) => Promise<void>;
  set: (
    minimum: [number, number, number],
    maximum: [number, number, number],
    block: string,
  ) => Promise<void>;
  teleport: (
    position: [number, number, number],
    yaw: number,
    pitch: number,
  ) => Promise<void>;
  lookAt: (position: [number, number, number]) => Promise<void>;
  use: (sneak?: boolean) => Promise<void>;
  attack: (sneak?: boolean) => Promise<void>;
  sign: (lines: [string, string, string, string]) => Promise<void>;
  transfer: (item: string, from: "container" | "inventory") => Promise<void>;
  capture: (presentation: Presentation) => Promise<void>;
  record: (
    presentation: Presentation,
    action: () => Promise<void>,
    seconds?: number,
  ) => Promise<void>;
};

export function defineCaptureScene(scene: CaptureScene): CaptureScene {
  return scene;
}
