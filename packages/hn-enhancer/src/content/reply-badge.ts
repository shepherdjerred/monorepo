import { getLoggedInUsername } from "#src/lib/dom.ts";
import { getLocalState, setLocalState, setSettings } from "#src/lib/storage.ts";
import type { Settings } from "#src/types/storage.ts";

let settings: Settings["replyNotifier"];

export function initReplyNotifier(s: Settings): void {
  settings = s.replyNotifier;

  // Auto-detect username if not set
  if (settings.myUsername === "") {
    const detected = getLoggedInUsername();
    if (detected !== undefined && detected !== "") {
      settings = { ...settings, myUsername: detected };
      void setSettings({
        replyNotifier: settings,
      });
    }
  }

  void renderBadge();

  // Listen for count changes from the service worker
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "replyCount" in changes) {
      void renderBadge();
    }
  });
}

async function renderBadge(): Promise<void> {
  if (!settings.enabled || !settings.myUsername) return;

  const state = await getLocalState();
  const count = state.replyCount;

  let badge = document.querySelector<HTMLSpanElement>("#hn-reply-badge");

  if (count === 0) {
    if (badge) badge.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement("span");
    badge.id = "hn-reply-badge";
    badge.className = "hn-reply-badge";
    badge.title = "New replies to your comments";

    badge.addEventListener("click", (e) => {
      e.preventDefault();
      // Reset count and navigate to threads
      void setLocalState({ replyCount: 0 });
      globalThis.location.href = `https://news.ycombinator.com/threads?id=${settings.myUsername}`;
    });

    // Insert into the HN header near the username
    const pagetop = document.querySelector(".pagetop");
    if (!pagetop) return;

    const userLink = pagetop.querySelector<HTMLAnchorElement>(`a[href="user?id=${settings.myUsername}"]`);
    if (userLink) {
      userLink.after(badge);
    } else {
      pagetop.append(badge);
    }
  }

  badge.textContent = String(count);
}
