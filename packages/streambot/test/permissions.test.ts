import { describe, expect, test } from "bun:test";
import {
  canControlItem,
  isAdmin,
} from "@shepherdjerred/streambot/discord/permissions.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

const admin = UserIdSchema.parse("100000000000000001");
const requester = UserIdSchema.parse("100000000000000002");
const other = UserIdSchema.parse("100000000000000003");
const admins = [admin];

describe("permissions", () => {
  test("isAdmin", () => {
    expect(isAdmin(admin, admins)).toBe(true);
    expect(isAdmin(other, admins)).toBe(false);
  });

  test("canControlItem allows admins and the original requester", () => {
    expect(canControlItem(admin, requester, admins)).toBe(true);
    expect(canControlItem(requester, requester, admins)).toBe(true);
    expect(canControlItem(other, requester, admins)).toBe(false);
    expect(canControlItem(other, null, admins)).toBe(false);
  });
});
