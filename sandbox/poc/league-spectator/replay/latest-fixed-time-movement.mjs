import { matchVelocityVerticalFacing } from "./latest-match-velocity-facing.mjs";

// Original FixedTimeMovement deadline and default GravityHeightSolver slice.
// Optional travel-time overrides are explicit inputs, never inferred absent.
const f = Math.fround;
const epsilon = f(1e-9),
  planeEpsilon = f(1e-5);
const number = (value) => Number.isFinite(value) && Number.isFinite(f(value));
const vector = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(number);
export const FIXED_TIME_CONTRACT = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  factoryRva: 0x874290,
  initializeRva: 0x87f730,
  stepRva: 0x87f830,
  arrivalRva: 0x87f9b0,
  gravityEvaluateRva: 0x882640,
  overrideQueryRva: 0x8298d0,
});
const planarLength = (v) => f(Math.sqrt(f(f(v[0] * v[0]) + f(v[2] * v[2]))));
export function createFixedTimeMovement(motion, controllers) {
  if (
    typeof motion?.fixedSpeedStep !== "function" ||
    typeof controllers?.fixedSpeedProgress !== "function"
  )
    throw Error("Verified shared vector/controller kernels required");
  function initialize({
    position,
    targetPosition,
    travelTime,
    startDelay,
    createdAt,
    travelTimeOverride,
    gravity = null,
  }) {
    if (
      !vector(position) ||
      !vector(targetPosition) ||
      ![travelTime, startDelay, createdAt].every(number) ||
      (travelTimeOverride !== null && !number(travelTimeOverride)) ||
      (gravity !== null && !number(gravity))
    )
      throw Error(
        "Explicit finite FixedTime constructor inputs and override presence required",
      );
    const duration = f(
        travelTimeOverride === null ? travelTime : travelTimeOverride,
      ),
      deadline = f(f(f(createdAt) + duration) + f(startDelay));
    const state = {
      position: position.map(f),
      initialPosition: position.map(f),
      targetPosition: targetPosition.map(f),
      duration,
      deadline,
      createdAt: f(createdAt),
      startDelay: f(startDelay),
      speed: 0,
      velocity: [0, 0, 0],
      cachedVelocity: [0, 0, 0],
      gravity: gravity === null ? null : f(gravity),
      arrived: false,
      history: [],
    };
    const remaining = f(deadline - f(createdAt));
    if (!(epsilon > remaining)) {
      const difference = state.targetPosition.map((lane, index) =>
        f(lane - state.position[index]),
      );
      state.speed = f(planarLength(difference) / remaining);
      state.velocity = motion.fixedSpeedStep(
        state.position,
        state.targetPosition,
        state.speed,
        0,
      ).velocity;
    }
    return state;
  }
  function gravityHeight(state, rawPredicted, progress) {
    if (
      (Math.abs(f(state.position[0] - rawPredicted[0])) <= planeEpsilon &&
        Math.abs(f(state.position[2] - rawPredicted[2])) <= planeEpsilon) ||
      (Math.abs(f(state.initialPosition[0] - state.targetPosition[0])) <=
        planeEpsilon &&
        Math.abs(f(state.initialPosition[2] - state.targetPosition[2])) <=
          planeEpsilon)
    )
      return rawPredicted[1];
    const distance = planarLength(
      state.initialPosition.map((lane, index) =>
        f(lane - state.targetPosition[index]),
      ),
    );
    const time = f(distance / f(planarLength(state.velocity) + planeEpsilon));
    const halfGravity = f(state.gravity * f(-0.5));
    const initialY = f(
      f(f(state.targetPosition[1] - state.initialPosition[1]) / time) -
        f(halfGravity * time),
    );
    const elapsed = f(time * f(progress));
    return f(
      f(f(f(halfGravity * elapsed) + initialY) * elapsed) +
        state.initialPosition[1],
    );
  }
  function step(state, now, delta, globalDelta = delta) {
    if (
      ![now, delta, globalDelta].every(number) ||
      delta < 0 ||
      globalDelta < 0 ||
      !vector(state.position) ||
      !vector(state.velocity)
    )
      throw Error("Finite supplied FixedTime frame clocks/state required");
    now = f(now);
    delta = f(delta);
    globalDelta = f(globalDelta);
    state.history.unshift([...state.position]);
    if (state.history.length > 60) state.history.pop();
    const remaining = f(state.deadline - now);
    let velocity,
      speed = state.speed;
    if (epsilon > remaining) velocity = [...state.velocity];
    else {
      const difference = state.targetPosition.map((lane, index) =>
        f(lane - state.position[index]),
      );
      speed = f(planarLength(difference) / remaining);
      velocity = motion.fixedSpeedStep(
        state.position,
        state.targetPosition,
        speed,
        0,
      ).velocity;
    }
    let displacement =
      now < state.deadline
        ? velocity.map((lane) => f(lane * f(Math.min(remaining, delta))))
        : state.targetPosition.map((lane, index) =>
            f(lane - state.position[index]),
          );
    if (f(state.createdAt + state.startDelay) > now) displacement = [0, 0, 0];
    state.arrived = f(f(now + delta) - globalDelta) > state.deadline;
    if (state.arrived)
      displacement = state.targetPosition.map((lane, index) =>
        f(lane - state.position[index]),
      );
    const rawPredicted = state.position.map((lane, index) =>
      f(lane + displacement[index]),
    );
    const progress = controllers.fixedSpeedProgress(
      state.initialPosition,
      state.targetPosition,
      rawPredicted,
      state.arrived,
    );
    if (state.gravity !== null)
      displacement[1] = f(
        gravityHeight(state, rawPredicted, progress) - state.position[1],
      );
    // Original callback 890880 reads the global frame delta, independently of
    // the local movement interval used for an event-split integration step.
    velocity[1] = matchVelocityVerticalFacing(displacement, globalDelta);
    state.velocity = velocity.every((lane) => lane === 0)
      ? [...state.cachedVelocity]
      : [...velocity];
    state.position = state.position.map((lane, index) =>
      f(lane + displacement[index]),
    );
    // The update owns its new speed; the original frame does not persist it
    // back into controller+a0. Actor application owns the velocity separately.
    return {
      speed,
      velocity,
      displacement,
      arrived: state.arrived,
      rawPredicted,
      progress,
      position: [...state.position],
      appliedVelocity: [...state.velocity],
      historySize: state.history.length,
    };
  }
  return Object.freeze({
    initialize,
    step,
    gravityHeight,
    actualMatchAdmitted: false,
  });
}
