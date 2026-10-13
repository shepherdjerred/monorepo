import { z } from "zod";
import wire from "#traversal-wire";

const Point = z.tuple([z.number(), z.number(), z.number()]);
export const TraversalSample = z.strictObject({
  tick: z.number().int().positive(),
  position: Point,
  velocity: Point,
  health: z.number().nonnegative(),
  fallDistance: z.number().nonnegative(),
  onGround: z.boolean(),
  inWater: z.boolean(),
  climbing: z.boolean(),
  jump: z.boolean(),
  damage: z.number().nonnegative(),
});
export const TraversalStatus = z.strictObject({
  version: z.literal(2),
  state: z.enum(["idle", "running", "passed", "failed"]),
  scenario: z.string(),
  ticks: z.number().int().nonnegative(),
  driveTicks: z.number().int().nonnegative(),
  body: z.string(),
  samples: z.array(TraversalSample),
});
const Scenario = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  arena: z.string().min(1),
  start: Point,
  goal: Point,
  sprint: z.boolean(),
  jumpDistance: z.number().min(-1),
  repeatJump: z.boolean(),
  minimumDriveTicks: z.number().int().min(1).max(580),
  maxTicks: z.number().int().min(21).max(600),
});
const Contract = z.strictObject({
  version: z.literal(2),
  states: z.array(z.string()),
  status: z.array(z.string()),
  sample: z.array(z.string()),
  scenarios: z.array(Scenario).min(1),
});
export const traversalContract = Contract.parse(wire);
if (
  JSON.stringify(traversalContract.status) !==
    JSON.stringify(Object.keys(TraversalStatus.shape)) ||
  JSON.stringify(traversalContract.sample) !==
    JSON.stringify(Object.keys(TraversalSample.shape)) ||
  JSON.stringify(traversalContract.states) !==
    JSON.stringify(TraversalStatus.shape.state.options) ||
  new Set(traversalContract.scenarios.map((scenario) => scenario.id)).size !==
    traversalContract.scenarios.length
)
  throw new Error("Traversal contract differs from consumer");

/** Summarize measured physics without substituting a predicted trajectory for native observations. */
export function summarizeTraversal(status: z.infer<typeof TraversalStatus>) {
  const selected = traversalContract.scenarios.find(
    (scenario) => scenario.id === status.scenario,
  );
  if (selected === undefined)
    throw new Error("Unknown traversal result identity");
  if (
    status.samples.length !== status.ticks ||
    status.samples.some((sample, index) => sample.tick !== index + 1)
  )
    throw new Error("Traversal result omitted or reordered native ticks");
  const driven = status.samples.slice(20);
  const last = status.samples.at(-1);
  if (last === undefined || driven.length === 0)
    throw new Error("Traversal result has no driven physics");
  const first = driven[0];
  if (
    first === undefined ||
    Math.hypot(
      first.position[0] - (400 + selected.start[0]),
      first.position[1] - selected.start[1],
      first.position[2] - (400 + selected.start[2]),
    ) > 0.3
  )
    throw new Error("Traversal body was not at the authored starting state");
  if (status.driveTicks !== driven.length)
    throw new Error("Traversal driven ticks differ from native observations");
  if (
    status.state === "passed" &&
    (status.driveTicks < selected.minimumDriveTicks ||
      Math.hypot(
        last.position[0] - (400 + selected.goal[0]),
        last.position[1] - selected.goal[1],
        last.position[2] - (400 + selected.goal[2]),
      ) > 0.7)
  )
    throw new Error(
      "Traversal passed without its full duration and destination",
    );
  if (status.state === "passed") validateFluidTraversal(selected, driven);
  return {
    scenario: selected.id,
    reached: status.state === "passed",
    ticks: status.ticks,
    driveTicks: status.driveTicks,
    maximumY: Math.max(...status.samples.map((sample) => sample.position[1])),
    maximumHorizontalVelocity: Math.max(
      ...driven.map((sample) =>
        Math.hypot(sample.velocity[0], sample.velocity[2]),
      ),
    ),
    damage: last.damage,
    health: last.health,
    jumpTicks: driven
      .filter((sample) => sample.jump)
      .map((sample) => sample.tick),
    groundedTicks: driven.filter((sample) => sample.onGround).length,
    waterTicks: driven.filter((sample) => sample.inWater).length,
    climbingTicks: driven.filter((sample) => sample.climbing).length,
    finalPosition: last.position,
  };
}

function validateFluidTraversal(
  selected: z.infer<typeof Scenario>,
  driven: z.infer<typeof TraversalSample>[],
) {
  if (
    selected.id === "water-lateral" &&
    driven.some(
      (sample) => Math.abs(sample.position[1] - selected.start[1]) > 0.25,
    )
  )
    throw new Error("Lateral underwater route gratuitously changed depth");
  if (
    selected.id === "water-throat" &&
    !driven.some((sample) => sample.position[1] <= 96.3)
  )
    throw new Error("Submerged overlap was not actually traversed");
  if (
    selected.id === "wet-ladder" &&
    !driven.some((sample) => sample.inWater && sample.climbing)
  )
    throw new Error(
      "Waterlogged ladder was not actually climbed while immersed",
    );
}

/** Equal authored starts/goals and grounded arrival distinguish useful jumps from overshoot. */
export function compareFlatTraversal(
  results: ReturnType<typeof summarizeTraversal>[],
) {
  const sprint = results.filter((result) => result.scenario === "sprint-flat");
  const jumping = results.filter(
    (result) => result.scenario === "sprint-jump-flat",
  );
  if (sprint.length === 0 || jumping.length === 0) return;
  if (
    sprint.length !== jumping.length ||
    [...sprint, ...jumping].some((result) => !result.reached)
  )
    throw new Error("Flat movement comparison needs equal successful trials");
  const sprintTicks =
    sprint.reduce((sum, result) => sum + result.driveTicks, 0) / sprint.length;
  const jumpTicks =
    jumping.reduce((sum, result) => sum + result.driveTicks, 0) /
    jumping.length;
  if (jumpTicks >= sprintTicks)
    throw new Error(
      "Sprint jumping did not improve native grounded arrival time",
    );
  return {
    sprintTicks,
    jumpTicks,
    savedTicks: sprintTicks - jumpTicks,
    repetitions: sprint.length,
  };
}
