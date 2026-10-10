import { request, waitFor, type Session } from "./protocol.ts";
import { viewpoint } from "./viewpoint.ts";
import { encodeVideo } from "./video.ts";
import { validateFrames, VideoStatus } from "./video-frames.ts";

async function state(session: Session) {
  const result = VideoStatus.parse(await request(session, "video-status"));
  if (result.state === "FAILED")
    throw new Error(`Rendered capture failed: ${result.error}`);
  return result;
}

/** Runs in the ordinary rendered client, outside GameTest's frame-per-tick driver. */
export async function verifyRenderedVideo(session: Session): Promise<void> {
  await request(session, "fixture", { name: "recording" });
  await viewpoint(session, "recording");
  await request(session, "capture", { name: "recording-label-before" });
  await request(session, "video-arm", {
    name: "native-thirty-seconds",
    frames: 900,
    fov: 70,
  });
  await waitFor(
    "armed rendered camera",
    () => state(session),
    (value) => value.state === "READY",
  );
  await request(session, "video-start");
  const finished = await waitFor(
    "900 real rendered frames",
    () => state(session),
    (value) => value.state === "COMPLETE",
    60_000,
  );
  const video = await encodeVideo(finished.receipt);
  const frames = validateFrames(await Bun.file(finished.receipt).json());
  if (new Set(frames.frames.map((frame) => frame.sha256)).size < 2) {
    throw new Error("Native animation did not appear in the rendered capture");
  }
  const label = await request(session, "fixture", { name: "recording-label" });
  if (typeof label !== "string" || !label.includes("StormCaptureLabel")) {
    throw new Error("The labelled subject did not survive the recording");
  }
  await request(session, "capture", { name: "recording-restored" });
  console.warn(`Verified 900 native rendered frames: ${video.video}`);
}
