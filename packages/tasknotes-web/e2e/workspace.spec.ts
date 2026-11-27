import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { SyncCommand } from "@shepherdjerred/facet-protocol";
import { z } from "zod";
import { accessHeaders, accessToken } from "./fixture-access.ts";
import { syncResponseFor } from "./workspace-test-fixture.ts";

async function submit(
  request: APIRequestContext,
  command: SyncCommand,
): Promise<string> {
  const tempId = crypto.randomUUID();
  const response = await syncResponseFor(request, [
    { temp_id: tempId, uuid: crypto.randomUUID(), command },
  ]);
  const id = response.temp_id_mapping[tempId];
  if (id === undefined)
    throw new Error("The test server did not return the created entity.");
  return id;
}

async function signIn(
  page: Page,
  path: string,
  remember = false,
): Promise<void> {
  await page.goto(path);
  await page.getByLabel("Access token").fill(accessToken);
  if (remember) await page.getByLabel("Remember on this browser").check();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("main")).not.toContainText("Sign in to Facet");
}

async function addTask(page: Page, input: string): Promise<void> {
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add task", exact: true })
    .last()
    .click();
  const capture = page.getByRole("dialog", { name: "Quick Add" });
  await capture.getByLabel("Task name").fill(input);
  await capture.getByLabel("Keep adding tasks").uncheck();
  await capture.getByRole("button", { name: "Add Task", exact: true }).click();
  await expect(capture).toBeHidden();
}

test("deep links survive sign-in, refresh, and history", async ({
  page,
  request,
}) => {
  const title = `Deep link ${crypto.randomUUID().slice(0, 6)}`;
  const id = await submit(request, {
    type: "TaskAdd",
    args: { title, project_id: "" },
  });
  await signIn(page, `/inbox?task=${id}`);
  await expect(
    page.getByRole("region", { name: "Task details" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Task name" })).toHaveValue(
    title,
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Task name" })).toHaveValue(
    title,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/u);
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`task=${id}$`, "u"));
  await page.goBack();
  await expect(page).toHaveURL(/\/inbox$/u);
  await page.goForward();
  await expect(page.getByRole("textbox", { name: "Task name" })).toHaveValue(
    title,
  );
});

test("Back protects a dirty task and Save reaches the sync server", async ({
  page,
  request,
}) => {
  const id = await submit(request, {
    type: "TaskAdd",
    args: { title: `Draft ${crypto.randomUUID().slice(0, 6)}`, project_id: "" },
  });
  await signIn(page, `/inbox?task=${id}`);
  const editor = page.getByRole("region", { name: "Task details" });
  const title = editor.getByRole("textbox", { name: "Task name" });
  const editedTitle = `Saved ${crypto.randomUUID().slice(0, 6)}`;
  await title.fill(editedTitle);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(title).toHaveValue(editedTitle);
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1/tasks/${id}`, {
        headers: accessHeaders,
      });
      return z.object({ title: z.string() }).parse(await response.json()).title;
    })
    .toBe(editedTitle);
});

test("capture and global search share today's workspace", async ({ page }) => {
  const title = `Review field notes ${crypto.randomUUID().slice(0, 6)}`;
  await signIn(page, "/today");
  await addTask(page, `${title} today p2`);
  await expect(
    page.getByRole("link", { name: new RegExp(title, "u") }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Search", exact: true })
    .first()
    .click();
  await page.getByRole("searchbox").fill(title);
  await expect(page).toHaveURL(/\/search\?q=/u);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("offline relaunch and reconnect preserve one copy of a captured task", async ({
  page,
  context,
  request,
}) => {
  const title = `Offline task ${crypto.randomUUID().slice(0, 6)}`;
  await signIn(page, "/inbox", true);
  await page.evaluate(async () => {
    await globalThis.navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.navigator.serviceWorker.controller !== null,
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  await addTask(page, title);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => {
    globalThis.dispatchEvent(new globalThis.Event("focus"));
  });
  await expect
    .poll(async () => {
      const response = await syncResponseFor(request, []);
      return response.tasks.filter((task) => task.title === title).length;
    })
    .toBe(1);
});

test.describe("sync transport", () => {
  test.use({ serviceWorkers: "block" });
  test("a lost sync response replays once and another tab sees the task", async ({
    page,
    context,
    request,
  }) => {
    const title = `Retry task ${crypto.randomUUID().slice(0, 6)}`;
    await signIn(page, "/inbox", true);
    const secondTab = await context.newPage();
    await secondTab.goto("/inbox");
    await expect(
      secondTab.getByRole("heading", { name: "Inbox", exact: true }),
    ).toBeVisible();
    const sent: string[] = [];
    const CommandEnvelopeSchema = z.object({ uuid: z.string() });
    await context.route("**/api/v1/sync", async (route) => {
      const raw = route.request().postData();
      if (raw?.includes(title) !== true) {
        await route.continue();
        return;
      }
      const { commands } = z
        .object({ commands: z.array(CommandEnvelopeSchema) })
        .parse(JSON.parse(raw));
      const edit = commands[0];
      if (edit === undefined)
        throw new Error("A matching request had no commands.");
      sent.push(edit.uuid);
      if (sent.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await addTask(page, title);
    await expect.poll(() => sent.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Sync", exact: true }).click();
    await expect.poll(() => sent.length).toBeGreaterThan(1);
    expect(new Set(sent).size).toBe(1);
    await expect(secondTab.getByRole("link", { name: title })).toBeVisible();
    const response = await syncResponseFor(request, []);
    expect(response.tasks.filter((task) => task.title === title)).toHaveLength(
      1,
    );
  });
});

test("repeating tasks advance while offline and sync the same occurrence", async ({
  page,
  context,
  request,
}) => {
  const title = `Repeat ${crypto.randomUUID().slice(0, 6)}`;
  const taskId = await submit(request, {
    type: "TaskAdd",
    args: {
      title,
      project_id: "",
      due_date: "2099-07-20",
      recurrence_rule: "FREQ=DAILY;COUNT=2",
    },
  });
  await signIn(page, "/inbox");
  const task = page.getByRole("link", { name: new RegExp(title, "u") });
  await expect(task).toContainText("Jul 20");
  await context.setOffline(true);
  await page.getByRole("checkbox", { name: `Complete ${title}` }).click();
  await expect(task).toContainText("Jul 21");
  await context.setOffline(false);
  await expect
    .poll(async () => {
      const response = await syncResponseFor(request, []);
      const committed = response.tasks.find((item) => item.id === taskId);
      return committed?.due_date?.slice(0, 10);
    })
    .toBe("2099-07-21");
});

test("project board moves and undo preserve a task", async ({
  page,
  request,
}) => {
  const title = `Proof board ${crypto.randomUUID().slice(0, 6)}`;
  const projectId = await submit(request, {
    type: "ProjectAdd",
    args: { name: title },
  });
  const sectionId = await submit(request, {
    type: "SectionAdd",
    args: { project_id: projectId, name: "In review" },
  });
  const taskId = await submit(request, {
    type: "TaskAdd",
    args: { project_id: projectId, title: "Prepare screenshots" },
  });
  await signIn(page, `/projects/${projectId}`);
  await page
    .getByRole("combobox", { name: "Layout", exact: true })
    .selectOption("board");
  const board = page.getByRole("region", { name: "Project board" });
  await expect(board).toBeVisible();
  await board.getByText("Task actions", { exact: true }).click();
  await board.getByLabel("Move task").selectOption({ label: "In review" });
  await expect
    .poll(async () => {
      const response = await syncResponseFor(request, []);
      return response.tasks.find((task) => task.id === taskId)?.section_id;
    })
    .toBe(sectionId);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await syncResponseFor(request, []);
      return (
        response.tasks.find((task) => task.id === taskId)?.section_id ?? ""
      );
    })
    .toBe("");
});

test("attachment upload stays private and downloads under the original name", async ({
  page,
  request,
}) => {
  const taskId = await submit(request, {
    type: "TaskAdd",
    args: { project_id: "", title: "Attachment proof" },
  });
  const fileName = "review-notes.txt";
  const bytes = Buffer.from("A Facet browser fixture.");
  await signIn(page, `/inbox?task=${taskId}`);
  await page
    .getByLabel("Attach a file")
    .setInputFiles({ name: fileName, mimeType: "text/plain", buffer: bytes });
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const readAttachment = async () => {
    const response = await syncResponseFor(request, []);
    return response.tasks
      .find((task) => task.id === taskId)
      ?.comments?.find((comment) => comment.file_name === fileName);
  };
  await expect
    .poll(async () => {
      const file = await readAttachment();
      return file?.id;
    })
    .toBeDefined();
  const attached = await readAttachment();
  if (attached === undefined)
    throw new Error("The server did not retain the uploaded attachment.");
  const denied = await request.get(
    `/api/v1/tasks/${taskId}/comments/${attached.id}/file`,
  );
  expect(denied.status()).toBe(401);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: `Download ${fileName}`, exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(fileName);
});
