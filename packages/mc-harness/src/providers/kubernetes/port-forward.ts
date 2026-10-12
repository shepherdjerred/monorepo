/**
 * Supervised `kubectl port-forward` for one sandbox pod: binds random local
 * ports on 127.0.0.1, reports which local port serves each container port,
 * and restarts with backoff while the sandbox exists (port-forward exits when
 * the API server connection drops).
 */

export type ForwardProcess = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill: () => void;
};

export type ProcessSpawner = (argv: readonly string[]) => ForwardProcess;

export const spawnProcess: ProcessSpawner = (argv) => {
  const subprocess = Bun.spawn(["kubectl", ...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  return {
    stdout: subprocess.stdout,
    exited: subprocess.exited,
    kill: () => {
      subprocess.kill();
    },
  };
};

const FORWARD_LINE = /^Forwarding from 127\.0\.0\.1:(\d+) -> (\d+)$/u;

/** Maps container port -> local port from `kubectl port-forward` output. */
export function parseForwardedPorts(text: string): Map<number, number> {
  const ports = new Map<number, number>();
  for (const line of text.split("\n")) {
    const match = FORWARD_LINE.exec(line.trim());
    if (match !== null) {
      ports.set(Number(match[2]), Number(match[1]));
    }
  }
  return ports;
}

/** `port-forward` args after the kubectl target prefix. */
export function portForwardArgs(
  pod: string,
  ports: readonly number[],
): string[] {
  return [
    "port-forward",
    "--address",
    "127.0.0.1",
    `pod/${pod}`,
    ...ports.map((port) => `:${port.toString()}`),
  ];
}

export type PortForwardOptions = {
  /** Full kubectl argv (target prefix + port-forward args). */
  argv: readonly string[];
  ports: readonly number[];
  spawn?: ProcessSpawner;
  /** Called with the new mapping after a restart. */
  onRestart?: (ports: Map<number, number>) => void;
  onError?: (error: unknown) => void;
  startTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_BACKOFF_MS = 30_000;

async function signalWhenDone<const Signal extends string>(
  promise: Promise<unknown>,
  signal: Signal,
): Promise<Signal> {
  await promise;
  return signal;
}

async function drain(reader: {
  read: () => Promise<{ done: boolean }>;
}): Promise<void> {
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) {
        return;
      }
    }
  } catch {
    // The process was killed; nothing left to read.
  }
}

export class PortForward {
  private process: ForwardProcess | null = null;
  private stopped = false;
  private readonly spawn: ProcessSpawner;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: PortForwardOptions) {
    this.spawn = options.spawn ?? spawnProcess;
    this.sleep = options.sleep ?? Bun.sleep;
  }

  get active(): boolean {
    return !this.stopped && this.process !== null;
  }

  /** Starts the forward and resolves once every requested port is bound. */
  async start(): Promise<Map<number, number>> {
    const ports = await this.spawnOnce();
    void this.supervise();
    return ports;
  }

  stop(): void {
    this.stopped = true;
    this.process?.kill();
    this.process = null;
  }

  private async spawnOnce(): Promise<Map<number, number>> {
    const child = this.spawn(this.options.argv);
    this.process = child;
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const exited = signalWhenDone(child.exited, "exited");
    const timedOut = signalWhenDone(
      this.sleep(this.options.startTimeoutMs ?? 30_000),
      "timeout",
    );
    for (;;) {
      const next = await Promise.race([reader.read(), exited, timedOut]);
      if (next === "timeout") {
        child.kill();
        throw new Error(`port-forward did not bind in time:\n${text}`);
      }
      if (next === "exited") {
        throw new Error(`port-forward exited before binding:\n${text}`);
      }
      if (next.done) {
        throw new Error(`port-forward closed its output:\n${text}`);
      }
      text += decoder.decode(next.value, { stream: true });
      const ports = parseForwardedPorts(text);
      if (this.options.ports.every((port) => ports.has(port))) {
        // port-forward logs every connection; an unread pipe would block it.
        void drain(reader);
        return ports;
      }
    }
  }

  /** A method, not the field, so checks after an await are re-read. */
  private isStopped(): boolean {
    return this.stopped;
  }

  private async supervise(): Promise<void> {
    let backoff = 1000;
    while (!this.isStopped()) {
      await this.process?.exited;
      if (this.isStopped()) {
        return;
      }
      await this.sleep(backoff);
      if (this.isStopped()) {
        return;
      }
      try {
        const ports = await this.spawnOnce();
        backoff = 1000;
        this.options.onRestart?.(ports);
      } catch (error) {
        this.options.onError?.(error);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }
}
