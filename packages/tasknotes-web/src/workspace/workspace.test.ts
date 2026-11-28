import { Priority } from "@shepherdjerred/facet-protocol";
import { describe, expect, test } from "vitest";
import { label, project, section, task, workspace } from "./fixtures.ts";
import { workspaceView } from "./workspace-view.ts";
import {
  completedTasks,
  inboxTasks,
  projectGroups,
  sortTasks,
  swatchColor,
  todayGroups,
  upcomingGroups,
} from "./workspace.ts";

const zone = "America/Los_Angeles";
const current = "2026-11-25";

describe("workspace queries", () => {
  test("sorts by child order, then priority, then creation", () => {
    const tasks = [
      task({
        id: "late",
        title: "Late",
        priority: Priority.P1,
        created_at: "2026-11-02T00:00:00.000Z",
      }),
      task({
        id: "early",
        title: "Early",
        priority: Priority.P4,
        child_order: 0,
        created_at: "2026-11-01T00:00:00.000Z",
      }),
      task({ id: "second", title: "Second", child_order: 2 }),
      task({
        id: "p1",
        title: "Urgent",
        priority: Priority.P1,
        created_at: "2026-11-03T00:00:00.000Z",
      }),
    ];
    expect([...tasks].sort(sortTasks).map((item) => item.id)).toEqual([
      "late",
      "p1",
      "early",
      "second",
    ]);
  });

  test("keeps inbox to the inbox project and unassigned tasks", () => {
    const data = workspace({
      projects: [
        project({ id: "inbox", name: "Inbox", is_inbox: true }),
        project({ id: "home", name: "Home" }),
        project({ id: "old", name: "Old", is_archived: true }),
      ],
      tasks: [
        task({ id: "in", title: "In inbox" }),
        task({ id: "loose", title: "Loose", project_id: "" }),
        task({ id: "home", title: "At home", project_id: "home" }),
        task({ id: "child", title: "Child", parent_id: "in" }),
        task({ id: "done", title: "Done", completed: true }),
        task({ id: "archived", title: "Archived", project_id: "old" }),
        task({ id: "gone", title: "Gone", is_deleted: true }),
      ],
    });
    expect(inboxTasks(data, "").map((item) => item.id)).toEqual([
      "in",
      "loose",
    ]);
    expect(inboxTasks(data, "loose").map((item) => item.id)).toEqual(["loose"]);
  });

  test("splits today into overdue and due today", () => {
    const data = workspace({
      projects: [project({ id: "inbox", name: "Inbox", is_inbox: true })],
      tasks: [
        task({ id: "over", title: "Over", due_date: "2026-11-24" }),
        task({ id: "today", title: "Today", due_date: "2026-11-25" }),
        task({
          id: "instant",
          title: "Evening",
          due_datetime: "2026-11-26T07:30:00.000Z",
        }),
        task({ id: "later", title: "Later", due_date: "2026-11-27" }),
        task({ id: "none", title: "Undated" }),
      ],
    });
    const groups = todayGroups(data, "", current, zone);
    expect(groups.map((group) => group.title)).toEqual([
      "Overdue",
      "Due today",
    ]);
    expect(groups[0]?.tasks.map((item) => item.id)).toEqual(["over"]);
    expect(groups[1]?.tasks.map((item) => item.id)).toEqual([
      "today",
      "instant",
    ]);
  });

  test("upcoming includes overdue only on the first page", () => {
    const data = workspace({
      tasks: [
        task({ id: "over", title: "Over", due_date: "2026-11-20" }),
        task({ id: "soon", title: "Soon", due_date: "2026-11-26" }),
      ],
    });
    const first = upcomingGroups({
      data,
      search: "",
      current,
      timeZone: zone,
      offset: 0,
    });
    expect(first[0]?.title).toBe("Overdue");
    expect(first.some((group) => group.civilDate === "2026-11-26")).toBe(true);
    const next = upcomingGroups({
      data,
      search: "",
      current,
      timeZone: zone,
      offset: 7,
    });
    expect(next.some((group) => group.title === "Overdue")).toBe(false);
    expect(next[0]?.civilDate).toBe("2026-12-02");
  });
});

describe("workspace destinations", () => {
  test("lists completed tasks newest first", () => {
    const data = workspace({
      tasks: [
        task({
          id: "older",
          title: "Older",
          completed: true,
          completed_at: "2026-11-01T00:00:00.000Z",
        }),
        task({
          id: "newer",
          title: "Newer",
          completed: true,
          completed_at: "2026-11-20T00:00:00.000Z",
        }),
        task({ id: "open", title: "Open" }),
      ],
    });
    expect(completedTasks(data, "").map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  test("groups a project by section", () => {
    const data = workspace({
      projects: [project({ id: "home", name: "Home" })],
      sections: [
        section({
          id: "later",
          name: "Later",
          project_id: "home",
          section_order: 2,
        }),
        section({
          id: "now",
          name: "Now",
          project_id: "home",
          section_order: 1,
        }),
        section({
          id: "hidden",
          name: "Hidden",
          project_id: "home",
          is_archived: true,
        }),
      ],
      tasks: [
        task({ id: "loose", title: "Loose", project_id: "home" }),
        task({
          id: "now",
          title: "Now",
          project_id: "home",
          section_id: "now",
        }),
        task({
          id: "hidden",
          title: "Hidden",
          project_id: "home",
          section_id: "hidden",
        }),
      ],
    });
    const groups = projectGroups(data, "home", "");
    expect(
      groups.map((group) => [group.title, group.tasks.map((item) => item.id)]),
    ).toEqual([
      ["No section", ["loose", "hidden"]],
      ["Now", ["now"]],
      ["Later", []],
    ]);
  });

  test("names a label destination", () => {
    const data = workspace({
      labels: [label({ id: "errand", name: "errand" })],
      tasks: [
        task({ id: "buy", title: "Buy milk", label_ids: ["errand"] }),
        task({ id: "other", title: "Other" }),
      ],
    });
    const view = workspaceView({
      data,
      destination: { kind: "label", id: "errand" },
      search: "",
      today: current,
      timeZone: zone,
      upcomingOffset: 0,
    });
    expect(view.title).toBe("@errand");
    expect(view.groups[0]?.tasks.map((item) => item.id)).toEqual(["buy"]);
  });

  test("accepts only policy colors for swatches", () => {
    expect(swatchColor(" Blue ")).toBe("#2973e0");
    expect(swatchColor("berry_red")).toBe("#b8245e");
    expect(swatchColor("gray")).toBe("#808080");
    expect(swatchColor("#9a3412")).toBe("#9a3412");
    expect(
      swatchColor("red; background: url(https://example.test)"),
    ).toBeUndefined();
  });
});
