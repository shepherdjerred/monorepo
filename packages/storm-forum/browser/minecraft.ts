// Browser refreshes only the public cache; it never probes or wakes Minecraft.
import { z } from "zod";

const ReplySchema = z.object({
  html: z.string(),
  status: z.object({ checkedAt: z.number().nullable() }),
});
const card = document.querySelector<HTMLElement>("[data-storm-minecraft]");
if (card) {
  const endpoint = card.dataset["stormMinecraft"];
  const live = card.querySelector<HTMLElement>("[data-storm-minecraft-live]");
  if (endpoint === undefined || endpoint === "" || !live)
    throw new Error("Minecraft card is missing its refresh contract");
  const statusEndpoint = new URL(endpoint, location.href).href;
  let checkedAt = Number(card.dataset["checkedAt"]);
  const staleAfter = Number(card.dataset["staleAfter"]);
  let pending = false;
  function expire() {
    if (checkedAt > 0 && Date.now() / 1000 - checkedAt <= staleAfter) return;
    const badge = live?.querySelector<HTMLElement>("[data-minecraft-state]");
    if (badge) {
      badge.textContent = "Status unavailable";
      badge.classList.remove("stormJoinBadge--online");
    }
    for (const state of live?.querySelectorAll<HTMLElement>(
      "[data-edition-state]",
    ) ?? [])
      state.textContent = "Status unavailable";
    for (const label of live?.querySelectorAll<HTMLElement>(
      "[data-version-label]",
    ) ?? [])
      label.textContent = "Last verified version";
    const roster = live?.querySelector<HTMLElement>("[data-minecraft-players]");
    if (roster) roster.textContent = "Player list unavailable.";
    const instruction = live?.querySelector<HTMLElement>(
      "[data-minecraft-instruction]",
    );
    if (instruction)
      instruction.textContent =
        "The status check is unavailable. You can still try joining.";
  }
  async function refresh() {
    if (pending || document.hidden) return;
    pending = true;
    try {
      const response = await fetch(statusEndpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(
          `Minecraft cache returned HTTP ${String(response.status)}`,
        );
      const result = ReplySchema.parse(await response.json());
      // The same-origin XenForo template escapes every value; no remote game HTML is accepted.
      if (live && live.innerHTML !== result.html) live.innerHTML = result.html;
      checkedAt = result.status.checkedAt ?? 0;
    } catch (error) {
      console.warn(
        "Minecraft card refresh failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      pending = false;
      expire();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
  setInterval(() => {
    void refresh();
  }, 60_000);
  expire();
  void refresh();
}
