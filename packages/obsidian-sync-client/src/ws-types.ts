import { z } from "zod";

export const PushNotificationSchema = z.object({
  op: z.literal("push"),
  path: z.string(),
  uid: z.number(),
  folder: z.boolean(),
  deleted: z.boolean(),
  size: z.number(),
  hash: z.string(),
  ctime: z.number(),
  mtime: z.number(),
  relatedpath: z.string().optional(),
  device: z.string().optional(),
  user: z.number().optional(),
  wasJustPushed: z.boolean().optional(),
});

export type PushNotification = z.infer<typeof PushNotificationSchema>;

export type ReadyMessage = {
  op: "ready";
  version: number;
};

export const PullResponseSchema = z.object({
  size: z.number(),
  pieces: z.number(),
  deleted: z.boolean().optional(),
});

export type Msg = Record<string, unknown>;

const MsgSchema = z.record(z.string(), z.unknown());

export function parseJsonMessage(data: string): Msg | null {
  try {
    const parsed: unknown = JSON.parse(data);
    const result = MsgSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type ConnectParams = {
  host: string;
  token: string;
  vaultId: string;
  version: number;
  initial: boolean;
  device: string;
  onReady: (version: number) => void;
  onPush: (notification: PushNotification) => void;
};

export type PushParams = {
  path: string;
  relatedPath: string | null;
  folder: boolean;
  deleted: boolean;
  ctime: number;
  mtime: number;
  hash: string;
  data: ArrayBuffer | null;
};

export type JustPushedEntry = {
  path: string;
  folder: boolean;
  deleted: boolean;
  mtime: number;
  hash: string;
};

export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) {
    return "";
  }
  return filePath.slice(lastDot + 1).toLowerCase();
}
