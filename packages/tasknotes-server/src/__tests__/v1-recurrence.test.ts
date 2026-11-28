import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { InMemoryFacetStore } from "../v1/stores/in-memory-store.ts";
import { computeNextOccurrence } from "@shepherdjerred/facet-protocol/recurrence";
import { v1Routes } from "../v1/routes.ts";

const RecurringTaskSchema = z.object({
  id: z.string(),
  due_date: z.string().optional(),
  due_datetime: z.string().optional(),
  is_recurring: z.boolean(),
  recurrence_rule: z.string().optional(),
  completed: z.boolean(),
  completed_at: z.string().optional(),
});

const SyncRecurringSchema = z.object({
  sync_token: z.string(),
  temp_id_mapping: z.record(z.string(), z.string()),
  sync_status: z.record(z.string(), z.string()),
  tasks: z.array(RecurringTaskSchema),
});

const AUTH = {
  "x-user-id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "content-type": "application/json",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

test.each([
  ["spring gap", "2026-03-07T10:30:00.000Z", "2026-03-08T10:30:00.000Z"],
  ["fall overlap", "2026-10-31T08:30:00.000Z", "2026-11-01T08:30:00.000Z"],
])(
  "resolves the %s with compatible DST disambiguation",
  (_caseName, dueDatetime, expected) => {
    const result = computeNextOccurrence({
      rule: "FREQ=DAILY",
      dueDatetime,
      dueTimezone: "America/Los_Angeles",
    });
    expect(result).toEqual({
      ended: false,
      nextDate: new Date(expected),
      updatedRule: "FREQ=DAILY",
    });
  },
);

describe("RFC 5545 Recurrence Calculator & Completion Advancement", () => {
  test("computes DAILY, WEEKLY BYDAY, MONTHLY BYMONTHDAY/-1, YEARLY, COUNT, and UNTIL", () => {
    // DAILY with INTERVAL=3
    const daily = computeNextOccurrence({
      rule: "FREQ=DAILY;INTERVAL=3",
      dueDate: "2026-03-10",
    });
    expect(daily.ended).toBe(false);
    if (!daily.ended) {
      expect(daily.nextDate.toISOString().slice(0, 10)).toBe("2026-03-13");
    }

    // WEEKLY with INTERVAL=2 and BYDAY=MO,WE,FR
    // 2026-11-16 is Monday -> next in same week is Wednesday 2026-11-18
    const weeklySameWeek = computeNextOccurrence({
      rule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
      dueDate: "2026-11-16",
    });
    expect(weeklySameWeek.ended).toBe(false);
    if (!weeklySameWeek.ended) {
      expect(weeklySameWeek.nextDate.toISOString().slice(0, 10)).toBe(
        "2026-11-18",
      );
    }

    // 2026-11-20 is Friday -> jumps 2 weeks to Monday 2026-11-30
    const weeklyNextCycle = computeNextOccurrence({
      rule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
      dueDate: "2026-11-20",
    });
    expect(weeklyNextCycle.ended).toBe(false);
    if (!weeklyNextCycle.ended) {
      expect(weeklyNextCycle.nextDate.toISOString().slice(0, 10)).toBe(
        "2026-11-30",
      );
    }

    // MONTHLY clamping Jan 31 -> Feb 28 and BYMONTHDAY=-1
    const monthlyClamp = computeNextOccurrence({
      rule: "FREQ=MONTHLY",
      dueDate: "2026-01-31",
    });
    expect(monthlyClamp.ended).toBe(false);
    if (!monthlyClamp.ended) {
      expect(monthlyClamp.nextDate.toISOString().slice(0, 10)).toBe(
        "2026-02-28",
      );
    }

    const monthlyByDay = computeNextOccurrence({
      rule: "DTSTART:20261001;FREQ=MONTHLY;BYMONTHDAY=1,15",
      dueDate: "2026-10-01",
    });
    expect(monthlyByDay.ended).toBe(false);
    if (!monthlyByDay.ended) {
      expect(monthlyByDay.nextDate.toISOString().slice(0, 10)).toBe(
        "2026-10-15",
      );
    }

    // YEARLY leap day clamping 2024-02-29 -> 2025-02-28
    const yearly = computeNextOccurrence({
      rule: "FREQ=YEARLY",
      dueDate: "2024-02-29",
    });
    expect(yearly.ended).toBe(false);
    if (!yearly.ended) {
      expect(yearly.nextDate.toISOString().slice(0, 10)).toBe("2025-02-28");
    }

    // COUNT decrements when > 1 and ends when COUNT=1
    const countDec = computeNextOccurrence({
      rule: "FREQ=DAILY;COUNT=2",
      dueDate: "2026-05-01",
    });
    expect(countDec).toEqual({
      ended: false,
      nextDate: new Date("2026-05-02T00:00:00.000Z"),
      updatedRule: "FREQ=DAILY;COUNT=1",
    });
    expect(
      computeNextOccurrence({
        rule: "FREQ=DAILY;COUNT=1",
        dueDate: "2026-05-02",
      }),
    ).toEqual({ ended: true });

    // UNTIL exhaustion
    expect(
      computeNextOccurrence({
        rule: "FREQ=DAILY;UNTIL=20260501",
        dueDate: "2026-05-01",
      }),
    ).toEqual({ ended: true });
  });

  describe("Sync TaskComplete & REST /close recurring advancement", () => {
    let store: InMemoryFacetStore;
    let app: Hono;

    beforeEach(() => {
      store = new InMemoryFacetStore();
      app = new Hono();
      app.route("/", v1Routes({ store }));
    });

    test("advances DAILY, WEEKLY, MONTHLY recurring tasks and marks completed on UNTIL exhaustion", async () => {
      const createdRes = await app.request("/api/v1/sync", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({
          commands: [
            {
              uuid: "rec-add-daily",
              temp_id: "tmp-daily",
              command: {
                type: "TaskAdd",
                args: {
                  title: "Daily vitamins",
                  due_date: "2026-06-01",
                  recurrence_rule: "FREQ=DAILY;UNTIL=20260602",
                },
              },
            },
            {
              uuid: "rec-add-weekly",
              temp_id: "tmp-weekly",
              command: {
                type: "TaskAdd",
                args: {
                  title: "Weekly standup",
                  due_date: "2026-11-16",
                  recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TH",
                },
              },
            },
            {
              uuid: "rec-add-monthly",
              temp_id: "tmp-monthly",
              command: {
                type: "TaskAdd",
                args: {
                  title: "Monthly rent",
                  due_date: "2026-06-01",
                  recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=1",
                },
              },
            },
          ],
        }),
      });
      const created = SyncRecurringSchema.parse(await createdRes.json());
      const dailyId = created.temp_id_mapping["tmp-daily"] ?? "";
      const weeklyId = created.temp_id_mapping["tmp-weekly"] ?? "";
      const monthlyId = created.temp_id_mapping["tmp-monthly"] ?? "";

      // Complete all three once via Sync
      const step1Res = await app.request("/api/v1/sync", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({
          sync_token: created.sync_token,
          commands: [
            {
              uuid: "rec-c1",
              command: { type: "TaskComplete", args: { id: dailyId } },
            },
            {
              uuid: "rec-c2",
              command: { type: "TaskComplete", args: { id: weeklyId } },
            },
            {
              uuid: "rec-c3",
              command: { type: "TaskComplete", args: { id: monthlyId } },
            },
          ],
        }),
      });
      const step1 = SyncRecurringSchema.parse(await step1Res.json());
      const dailyAfter1 = step1.tasks.find((t) => t.id === dailyId);
      const weeklyAfter1 = step1.tasks.find((t) => t.id === weeklyId);
      const monthlyAfter1 = step1.tasks.find((t) => t.id === monthlyId);

      expect(dailyAfter1?.due_date).toBe("2026-06-02");
      expect(dailyAfter1?.completed).toBe(false);
      expect(weeklyAfter1?.due_date).toBe("2026-11-19");
      expect(weeklyAfter1?.completed).toBe(false);
      expect(monthlyAfter1?.due_date).toBe("2026-07-01");
      expect(monthlyAfter1?.completed).toBe(false);

      // Complete daily task again via REST POST /api/v1/tasks/:id/close -> hits UNTIL=20260602, marks completed!
      const closeRes = await app.request(`/api/v1/tasks/${dailyId}/close`, {
        method: "POST",
        headers: AUTH,
      });
      expect(closeRes.status).toBe(204);

      const getDailyRes = await app.request(`/api/v1/tasks/${dailyId}`, {
        headers: AUTH,
      });
      const finalDaily = RecurringTaskSchema.parse(await getDailyRes.json());
      expect(finalDaily.completed).toBe(true);
      expect(finalDaily.completed_at).toBeDefined();

      // Closing monthly task via REST advances it to 2026-08-01 and keeps completed: false
      const closeMonthly = await app.request(
        `/api/v1/tasks/${monthlyId}/close`,
        {
          method: "POST",
          headers: AUTH,
        },
      );
      expect(closeMonthly.status).toBe(204);
      const getMonthlyRes = await app.request(`/api/v1/tasks/${monthlyId}`, {
        headers: AUTH,
      });
      const finalMonthly = RecurringTaskSchema.parse(
        await getMonthlyRes.json(),
      );
      expect(finalMonthly.completed).toBe(false);
      expect(finalMonthly.due_date).toBe("2026-08-01");
    });
  });
});
