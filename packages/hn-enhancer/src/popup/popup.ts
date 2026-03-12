import {
  getHiddenUsers,
  getSettings,
  removeHiddenUser,
  setSettings,
} from "#src/lib/storage.ts";
import type { Settings } from "#src/types/storage.ts";

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function $(id: string): HTMLElement {
  const el = document.querySelector(`#${id}`);
  if (!(el instanceof HTMLElement)) throw new Error(`Element #${id} not found`);
  return el;
}

function $input(id: string): HTMLInputElement {
  const el = document.querySelector(`#${id}`);
  if (!(el instanceof HTMLInputElement))
    throw new Error(`Element #${id} is not an input`);
  return el;
}

function $select(id: string): HTMLSelectElement {
  const el = document.querySelector(`#${id}`);
  if (!(el instanceof HTMLSelectElement))
    throw new Error(`Element #${id} is not a select`);
  return el;
}

async function loadSettings(): Promise<void> {
  const settings = await getSettings();

  // Sentiment filter
  $input("sentiment-enabled").checked = settings.sentimentFilter.enabled;
  $select("sentiment-mode").value = settings.sentimentFilter.mode;
  $select("sentiment-threshold").value = settings.sentimentFilter.threshold;
  $input("sentiment-llm").checked = settings.sentimentFilter.useLLM;
  updateLLMHint(settings.sentimentFilter.useLLM);
  toggleSubOptions("sentiment-options", settings.sentimentFilter.enabled);

  // Green accounts
  $input("green-enabled").checked = settings.hideGreenAccounts.enabled;
  $input("green-age").value = String(settings.hideGreenAccounts.ageDays);
  toggleSubOptions("green-options", settings.hideGreenAccounts.enabled);

  // Reply notifier
  $input("reply-enabled").checked = settings.replyNotifier.enabled;
  $input("reply-username").value = settings.replyNotifier.myUsername;
  $select("reply-interval").value = String(
    settings.replyNotifier.pollIntervalMinutes,
  );
  toggleSubOptions("reply-options", settings.replyNotifier.enabled);

  // Debug
  $input("debug-enabled").checked = settings.debug;
}

async function loadHiddenUsers(): Promise<void> {
  const users = await getHiddenUsers();
  const list = $("hidden-users-list");

  // Clear existing children safely
  while (list.firstChild) {
    list.firstChild.remove();
  }

  if (users.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "No hidden users";
    list.append(emptyState);
    return;
  }

  for (const username of users) {
    const item = document.createElement("div");
    item.className = "user-item";

    const name = document.createElement("span");
    name.textContent = username;

    const btn = document.createElement("button");
    btn.textContent = "unhide";
    btn.addEventListener("click", () => {
      void (async () => {
        await removeHiddenUser(username);
        await loadHiddenUsers();
      })();
    });

    item.append(name, btn);
    list.append(item);
  }
}

function updateLLMHint(checked: boolean): void {
  $("llm-setup-hint").style.display = checked ? "" : "none";
}

function toggleSubOptions(id: string, visible: boolean): void {
  $(id).dataset.hidden = visible ? "false" : "true";
}

function saveSettingsDebounced(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void saveSettings(), 300);
}

function parseSentimentMode(value: string): "dim" | "hide" | "label" {
  if (value === "dim" || value === "hide" || value === "label") return value;
  return "dim";
}

function parseSentimentThreshold(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}

async function saveSettings(): Promise<void> {
  const settings: Settings = {
    hideUsers: { enabled: true },
    sentimentFilter: {
      enabled: $input("sentiment-enabled").checked,
      mode: parseSentimentMode($select("sentiment-mode").value),
      threshold: parseSentimentThreshold($select("sentiment-threshold").value),
      useLLM: $input("sentiment-llm").checked,
    },
    hideGreenAccounts: {
      enabled: $input("green-enabled").checked,
      ageDays: Number($input("green-age").value) || 14,
    },
    replyNotifier: {
      enabled: $input("reply-enabled").checked,
      myUsername: $input("reply-username").value,
      pollIntervalMinutes: Number($select("reply-interval").value) || 15,
    },
    debug: $input("debug-enabled").checked,
  };

  await setSettings(settings);

  // Update sub-options visibility
  toggleSubOptions("sentiment-options", settings.sentimentFilter.enabled);
  toggleSubOptions("green-options", settings.hideGreenAccounts.enabled);
  toggleSubOptions("reply-options", settings.replyNotifier.enabled);
  updateLLMHint(settings.sentimentFilter.useLLM);
}

function setupListeners(): void {
  const inputs = document.querySelectorAll("input, select");
  for (const input of inputs) {
    input.addEventListener("change", saveSettingsDebounced);
    input.addEventListener("input", saveSettingsDebounced);
  }
}

async function init(): Promise<void> {
  await loadSettings();
  await loadHiddenUsers();
  setupListeners();

  // Listen for storage changes (e.g. user hides someone from the content script)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && "hiddenUsers" in changes) {
      void loadHiddenUsers();
    }
  });
}

void init();
