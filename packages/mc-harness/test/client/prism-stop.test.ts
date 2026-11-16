import { describe, expect, it, vi } from "vitest";
import { stopPrism } from "#daemon/prism-process.ts";

describe("Prism process shutdown", () => {
  it("signals only the session process and stops once it exits", async () => {
    let running = true;
    const find = vi.fn((path: string) =>
      path === "/tmp/owned-session" && running ? 123 : undefined,
    );
    const signal = vi.fn(() => {
      running = false;
    });
    await stopPrism("/tmp/owned-session", 0, { find, signal });
    expect(signal).toHaveBeenCalledExactlyOnceWith(123, "SIGTERM");
    expect(find).toHaveBeenCalledWith("/tmp/owned-session");
  });
  it("does not signal when no owned process exists", async () => {
    const signal = vi.fn();
    await stopPrism("/tmp/other-session", 0, {
      find: vi.fn<() => number | undefined>(),
      signal,
    });
    expect(signal).not.toHaveBeenCalled();
  });
  it("terminates all JVMs sharing the same session bootstrap property", async () => {
    const alive = new Set<number>([101, 202]);
    const find = vi.fn((sessionPath: string) =>
      sessionPath === "/tmp/shared-session" ? [...alive] : [],
    );
    const signal = vi.fn((pid: number) => {
      alive.delete(pid);
    });
    await stopPrism("/tmp/shared-session", 0, { find, signal });
    expect(signal).toHaveBeenCalledWith(101, "SIGTERM");
    expect(signal).toHaveBeenCalledWith(202, "SIGTERM");
    expect(alive.size).toBe(0);
  });
});
