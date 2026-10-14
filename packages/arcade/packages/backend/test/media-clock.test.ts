import { expect, it, vi } from "vitest";
import { NativeMediaClock } from "#src/media/clock.ts";

it("keeps 30 fps video aligned with PCM despite fractional source FPS and dropped renders", () => {
  const frame = vi.fn();
  const audio = vi.fn();
  const clock = new NativeMediaClock({ frame, audio });
  const first = Buffer.from([1]);
  const latest = Buffer.from([2]);
  clock.audio(Buffer.alloc(1920), 0);
  expect(audio).not.toHaveBeenCalled();
  clock.video(first, 0);
  for (let tick = 0; tick < 100; tick++)
    clock.audio(Buffer.alloc(1920), tick * 10);
  expect(frame).toHaveBeenCalledTimes(30);
  expect(audio).toHaveBeenCalledTimes(100);
  clock.video(latest, 1000);
  for (let tick = 0; tick < 100; tick++)
    clock.audio(Buffer.alloc(1920), 1000 + tick * 10);
  expect(frame).toHaveBeenCalledTimes(60);
  expect(frame.mock.calls.at(-1)?.[0]).toBe(latest);
  expect(() => clock.audio(Buffer.alloc(3), 2000)).toThrow("Partial");
});
