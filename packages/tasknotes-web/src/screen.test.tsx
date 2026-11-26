import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { task, workspace } from "./fixtures.ts";
import { ConnectScreen } from "./connect-screen.tsx";
import { TaskList } from "./task-list.tsx";
import { workspaceView } from "./workspace.ts";

function ignore(): void {
  return;
}

describe("screen", () => {
  test("renders the sign-in form", () => {
    const html = renderToStaticMarkup(
      <ConnectScreen
        initialOrigin="http://127.0.0.1:3000"
        initialToken=""
        initialRemember={false}
        error={null}
        busy={false}
        onSubmit={ignore}
      />,
    );
    expect(html).toContain("Sign in");
    expect(html).toContain("Remember on this browser");
    expect(html).toContain('type="password"');
  });

  test("renders an overdue task with a text label", () => {
    const data = workspace({
      tasks: [task({ id: "over", title: "Pay rent", due_date: "2026-11-24" })],
    });
    const view = workspaceView({
      data,
      destination: { kind: "section", section: "today" },
      search: "",
      today: "2026-11-25",
      timeZone: "America/Los_Angeles",
      upcomingOffset: 0,
    });
    const html = renderToStaticMarkup(
      <TaskList
        view={view}
        tasks={data.tasks}
        timeZone="America/Los_Angeles"
        today="2026-11-25"
        onToggle={ignore}
        onOpen={ignore}
      />,
    );
    expect(html).toContain("Overdue");
    expect(html).toContain("Pay rent");
    expect(html).toContain("Complete Pay rent");
  });
});
