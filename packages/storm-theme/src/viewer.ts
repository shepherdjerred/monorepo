import { z } from "zod";

const ViewerResponse = z.object({
  viewer: z
    .object({
      id: z.number().int().positive(),
      username: z.string().min(1),
      avatar: z.url().nullable(),
      profile: z.url(),
      alerts: z.number().int().nonnegative(),
      conversations: z.number().int().nonnegative(),
    })
    .nullable(),
  links: z.object({
    login: z.url(),
    // Additive during coordinated docs/forum releases; null means registration is closed.
    register: z.url().nullable().optional(),
    account: z.url(),
    "account/alerts": z.url(),
    conversations: z.url(),
    logout: z.url(),
  }),
});

export function startViewer(root: HTMLElement, api: URL): void {
  const element = root.querySelector<HTMLElement>("[data-storm-account]");
  if (!element) throw new Error("Missing Storm account control");
  const account: HTMLElement = element;
  let pending = false;
  function link(title: string, href: string): HTMLAnchorElement {
    const url = new URL(href);
    if (url.origin !== api.origin)
      throw new Error("Unexpected account link origin");
    const anchor = document.createElement("a");
    anchor.href = url.href;
    anchor.textContent = title;
    return anchor;
  }
  async function refresh(): Promise<void> {
    if (pending) return;
    pending = true;
    try {
      const response = await fetch(new URL("viewer", api), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Account request failed");
      const { viewer, links } = ViewerResponse.parse(await response.json());
      account.replaceChildren();
      if (viewer === null) {
        account.append(link("Log in", links.login));
        if (links.register !== undefined && links.register !== null) {
          account.append(link("Register", links.register));
        }
        return;
      }
      const menu = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = viewer.username;
      if (viewer.avatar !== null) {
        const url = new URL(viewer.avatar);
        if (url.origin !== api.origin)
          throw new Error("Unexpected avatar origin");
        const avatar = document.createElement("img");
        avatar.src = url.href;
        avatar.alt = "";
        avatar.width = 20;
        avatar.height = 20;
        summary.prepend(avatar);
      }
      const entries = document.createElement("div");
      entries.className = "stormAccountMenu";
      entries.append(
        link("Your profile", viewer.profile),
        link("Account", links.account),
        link(`Alerts (${String(viewer.alerts)})`, links["account/alerts"]),
        link(
          `Conversations (${String(viewer.conversations)})`,
          links.conversations,
        ),
        link("Log out", links.logout),
      );
      menu.append(summary, entries);
      account.append(menu);
    } catch {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry account";
      retry.title = "Account unavailable. Try again.";
      retry.addEventListener("click", () => {
        void refresh();
      });
      account.replaceChildren(retry);
    } finally {
      pending = false;
    }
  }
  window.addEventListener("pageshow", () => {
    void refresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
  void refresh();
}
