import { z } from "zod";
import type { RegressionAction } from "./regression-client.ts";

const replaced = /^(?:MoveToward|Stop|Jump|Sneak|Swing|Attack)\[/u;
const item = /^(?:StartUse|ReleaseUse|CancelUse)\[/u;
const identical = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
type Ticket = NonNullable<RegressionAction["ticket"]>;

function eligible(row: RegressionAction): boolean {
  return (
    row.heldSlot === 1 &&
    !row.usingItem &&
    row.targetId !== null &&
    row.authored.every(
      (command) =>
        !item.test(command) &&
        (!command.startsWith("SelectSlot[") ||
          command === "SelectSlot[slot=1]"),
    )
  );
}

function checkPolicy(row: RegressionAction) {
  if (row.kit !== "TROOPER") {
    if (row.decision !== "authored-kit")
      throw new Error("Regression decision differs from authored eligibility");
  } else if (!eligible(row)) {
    if (row.decision !== "ineligible")
      throw new Error("Regression decision differs from authored eligibility");
  } else if (!["unavailable", "applied"].includes(row.decision)) {
    throw new Error("Regression decision differs from authored eligibility");
  }
}

function checkedTicket(row: RegressionAction): Ticket {
  const ticket = row.ticket;
  if (
    ticket?.match !== row.match ||
    ticket.body !== row.body ||
    ticket.life !== row.life ||
    ticket.tick > row.botTick ||
    row.botTick - ticket.tick > 2
  )
    throw new Error("Regression action identity or age differs");
  return ticket;
}

function checkMovement(
  row: RegressionAction,
  ticket: Ticket,
  movement: string | undefined,
) {
  if (ticket.action.move === 4) {
    if (movement !== "Stop[]")
      throw new Error("Regression stop action differs");
    return;
  }
  const match =
    /^MoveToward\[waypoint=Vec3\[x=(?<x>[^,]+), y=(?<y>[^,]+), z=(?<z>[^\]]+)\], sprint=(?<sprint>true|false)\]$/u.exec(
      movement ?? "",
    );
  const point = z
    .strictObject({
      x: z.coerce.number(),
      y: z.coerce.number(),
      z: z.coerce.number(),
      sprint: z.enum(["true", "false"]),
    })
    .parse(match?.groups);
  const yaw = (((ticket.yaw % 360) + 540) % 360) - 180;
  const radians = (yaw * Math.PI) / 180;
  const forward = Math.floor(ticket.action.move / 3) - 1;
  const side = (ticket.action.move % 3) - 1;
  const dx = -Math.sin(radians) * forward - Math.cos(radians) * side;
  const dz = Math.cos(radians) * forward - Math.sin(radians) * side;
  const length = Math.hypot(dx, dz);
  if (
    Math.abs(point.x - row.x - dx / length) > 1e-7 ||
    Math.abs(point.y - row.y) > 1e-7 ||
    Math.abs(point.z - row.z - dz / length) > 1e-7 ||
    (point.sprint === "true") !== ticket.action.sprint
  )
    throw new Error("Regression movement differs from the original ticket");
}

function checkHeads(row: RegressionAction, ticket: Ticket, controls: string[]) {
  const action = ticket.action;
  if (controls.shift() !== `Sneak[sneaking=${action.sneak.toString()}]`)
    throw new Error("Regression sneak action differs");
  if (action.jump && controls.shift() !== "Jump[]")
    throw new Error("Regression jump action differs");
  if (
    action.attack &&
    (controls.shift() !== "Swing[]" ||
      controls.shift() !==
        `Attack[target=#${z.number().int().nonnegative().parse(row.targetId).toString()}]`)
  )
    throw new Error("Regression sword action differs");
  if (controls.length > 0)
    throw new Error("Unexpected regression controls reached the driver");
}

/** Check the selected native commands against their original authored step and action context. */
export function checkRegressionAction(row: RegressionAction) {
  checkPolicy(row);
  if (row.decision !== "applied") {
    if (row.ticket !== null || !identical(row.authored, row.commands))
      throw new Error("Regression fallback changed authored commands");
    return;
  }
  const ticket = checkedTicket(row);
  if (
    !identical(
      row.authored.filter((command) => !replaced.test(command)),
      row.commands.filter((command) => !replaced.test(command)),
    )
  )
    throw new Error("Regression action changed authored aim or item commands");
  const controls = row.commands.filter((command) => replaced.test(command));
  checkMovement(row, ticket, controls.shift());
  checkHeads(row, ticket, controls);
}
