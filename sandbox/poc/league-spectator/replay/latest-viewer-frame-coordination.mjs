// Explicit diagnostic capture owns presentation while ordinary playback is
// paused. Resuming Play invalidates that ownership; no stale guard is waived.
export class LatestDirectCaptureOwnership {
  #active = null;
  acquire() {
    if (this.#active)
      throw Error("A direct diagnostic capture is already active");
    return (this.#active = Object.freeze({}));
  }
  owns(token) {
    return token !== null && this.#active === token;
  }
  release(token) {
    if (this.owns(token)) this.#active = null;
  }
  blocksOrdinary(playing) {
    if (playing) this.#active = null;
    return this.#active !== null;
  }
}

// Camera selection precedes the request. CPU world/HUD work then overlaps the
// same owned worker operation; no later time is substituted or advance dropped.
export async function requestDirectFrameBeforeWorld({
  time,
  captureView,
  requestPresentation,
  updateWorld,
}) {
  const view = captureView(),
    pending = requestPresentation(time, view);
  try {
    updateWorld();
  } catch (error) {
    // The accepted operation still finishes. Observe its possible rejection
    // while preserving the actual synchronous world failure.
    Promise.resolve(pending).catch(() => {});
    throw error;
  }
  return { view, presentation: await pending };
}

export function isCurrentDirectViewerFrame({
  capturedReport,
  capturedSession,
  presentation,
  viewAspect,
  capturedFollow,
  report,
  session,
  time,
  aspect,
  follow,
}) {
  return (
    report === capturedReport &&
    session === capturedSession &&
    time === presentation.time &&
    aspect === viewAspect &&
    follow === capturedFollow &&
    capturedSession.isPresentationCurrent(presentation)
  );
}

export function applyViewerFollowTranslation(camera, controls, position) {
  const target = controls.target
    .clone()
    .set(position[0], position[1], -position[2]);
  camera.position.add(target.clone().sub(controls.target));
  controls.target.copy(target);
}

// Hero visibility is the viewer admission flag. Minions additionally have a
// causal corpse/retirement policy, sampled at the same requested timestamp.
export function sampleViewerFollowPosition(
  follow,
  at,
  { sampleHero, sampleMinion },
) {
  if (!follow) return null;
  if (follow.hero) {
    if (!follow.group.visible) return null;
    return sampleHero(follow, at);
  }
  const result = sampleMinion(follow, at);
  return result.visible ? result.position : null;
}

// Explicit captures synchronize every world/HUD input before selecting their
// follow camera; a prior ordinary RAF is never an implicit prerequisite.
export function captureSynchronizedDirectView({ updateWorld, captureView }) {
  updateWorld();
  return captureView();
}

// Missing causal movement/facing uses the loaded authored preview transform.
// It must never inherit a later attack's display yaw after a backward seek.
export function restoreViewerMinionBindPreview(entry) {
  entry.group.quaternion.copy(entry.bindRootQuaternion);
}

// Only the immediately following controls update may acknowledge our own
// follow translation. Any external input or mismatching pre-update transform
// consumes the marker without granting that acknowledgement.
export class LatestOwnedFollowCameraUpdate {
  #snapshot = null;
  clear() {
    this.#snapshot = null;
  }
  mark(snapshot) {
    if (typeof snapshot !== "string")
      throw Error("Exact follow camera snapshot required");
    this.#snapshot = snapshot;
  }
  consume(snapshot, interacting) {
    const owned =
      !interacting && this.#snapshot !== null && snapshot === this.#snapshot;
    this.#snapshot = null;
    return owned;
  }
}
