import { debug } from "#src/lib/debug.ts";
import { getCommentId, getCommentText, getCommentUsername } from "#src/lib/dom.ts";
import { classifyBatchProgressive, isLLMAvailable } from "#src/lib/llm-filter.ts";
import { getThresholdValue, hasAIKeywords, scoreSentiment } from "#src/lib/sentiment.ts";
import type { Settings } from "#src/types/storage.ts";

let settings: Settings["sentimentFilter"];

const hoverListeners = new WeakMap<HTMLTableRowElement, { enter: () => void; leave: () => void }>();

const filterStats = {
  total: 0,
  bySource: { regex: 0, llm: 0 },
  byCategory: new Map<string, number>(),
};

const CATEGORY_LABELS: Record<string, string> = {
  "reductive-label": "reductive labels",
  "slop": "slop/garbage",
  "snake-oil": "snake oil",
  "categorical-denial": "categorical denials",
  "regurgitation": "regurgitation claims",
  "bubble": "bubble/hype",
  "vibe-coding-contempt": "vibe coding contempt",
  "vibe-coding-dismissal": "vibe coding contempt",
  "mass-delusion": "mass delusion",
  "cargo-cult": "cargo cult",
  "confidently-wrong": "confidently wrong",
  "hallucination-absolutism": "hallucination absolutism",
  "ad-hominem": "ad hominem",
  "replacement-doom": "replacement doom",
  "skill-atrophy": "skill atrophy",
  "gatekeeping": "gatekeeping",
  "doom-prediction": "doom prediction",
  "absolutist-never": "absolutist claims",
  "reductive-just": "reductive dismissals",
  "authority-dismissal": "authority dismissal",
  "wrapper-dismissal": "wrapper dismissal",
  "user-contempt": "user contempt",
  "llm-detected": "LLM-detected",
};

export function initSentimentFilter(s: Settings): void {
  settings = s.sentimentFilter;
  processAllRows();
}

export function updateSentimentSettings(s: Settings["sentimentFilter"]): void {
  settings = s;
  clearAllSentimentMarkers();
  processAllRows();
}

export function processRows(rows: Iterable<HTMLTableRowElement>): void {
  if (!settings.enabled) return;

  const threshold = getThresholdValue(settings.threshold);
  const llmCandidates: { id: string; text: string; row: HTMLTableRowElement }[] = [];

  for (const row of rows) {
    const text = getCommentText(row);
    if (text === "") continue;

    const result = scoreSentiment(text);

    if (result.score >= threshold) {
      debug("sentiment", {
        action: "regex-match",
        id: getCommentId(row),
        username: getCommentUsername(row),
        text: text.slice(0, 80),
        score: result.score,
        matches: result.matches.map((m) => m.category),
        mode: settings.mode,
      });
      markAsNegative(row, settings.mode, "regex", result.matches.map((m) => m.category));
      continue;
    }

    // Pass 2: Queue for LLM if it has AI keywords (regardless of regex score)
    if (settings.useLLM && hasAIKeywords(text)) {
      debug("sentiment", {
        action: "llm-candidate",
        id: getCommentId(row),
        username: getCommentUsername(row),
        text: text.slice(0, 80),
        regexScore: result.score,
      });
      const candidate = { id: getCommentId(row), text, row };
      llmCandidates.push(candidate);
      addSpinner(row);
    }
  }

  if (llmCandidates.length > 0 && isLLMAvailable()) {
    debug("sentiment", { action: "llm-batch", count: llmCandidates.length });
    void processWithLLM(llmCandidates);
  }
}

async function processWithLLM(
  candidates: { id: string; text: string; row: HTMLTableRowElement }[],
): Promise<void> {
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const texts = candidates.map(({ id, text }) => ({ id, text }));

  await classifyBatchProgressive(texts, (id, result) => {
    const candidate = candidateMap.get(id);
    if (!candidate) return;
    removeSpinner(candidate.row);
    debug("llm", {
      id,
      negative: result?.negative,
      confidence: result?.confidence,
      willFilter: result?.negative === true && result.confidence >= 0.7,
    });
    if (result?.negative === true && result.confidence >= 0.7) {
      markAsNegative(candidate.row, settings.mode, "llm", ["llm-detected"]);
    }
  });
}

function processAllRows(): void {
  const rows = document.querySelectorAll<HTMLTableRowElement>("tr.athing.comtr");
  processRows(rows);
}

function markAsNegative(
  row: HTMLTableRowElement,
  mode: "dim" | "hide" | "label",
  source: "regex" | "llm",
  categories: string[],
): void {
  row.dataset.hnSentiment = "negative";

  // Track stats
  filterStats.total++;
  filterStats.bySource[source]++;
  for (const cat of categories) {
    filterStats.byCategory.set(cat, (filterStats.byCategory.get(cat) ?? 0) + 1);
  }
  updateSummaryBar();

  switch (mode) {
    case "dim": {
      row.style.opacity = "0.3";
      row.style.transition = "opacity 0.2s";

      const enter = (): void => { row.style.opacity = "1"; };
      const leave = (): void => { row.style.opacity = "0.3"; };
      row.addEventListener("mouseenter", enter);
      row.addEventListener("mouseleave", leave);
      hoverListeners.set(row, { enter, leave });
      break;
    }

    case "hide": {
      row.style.display = "none";
      break;
    }

    case "label": {
      addLabel(row);
      break;
    }
  }
}

function addLabel(row: HTMLTableRowElement): void {
  if (row.querySelector(".hn-sentiment-label")) return;

  const commtext = row.querySelector("span.commtext, div.commtext");
  if (!commtext || !(commtext instanceof HTMLElement)) return;

  const label = document.createElement("div");
  label.className = "hn-sentiment-label";

  const tag = document.createElement("span");
  tag.className = "hn-sentiment-tag";
  tag.textContent = "[AI negativity filtered]";

  const toggle = document.createElement("button");
  toggle.className = "hn-sentiment-toggle";
  toggle.textContent = "show";
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    const isHidden = commtext.style.display === "none";
    commtext.style.display = isHidden ? "" : "none";
    toggle.textContent = isHidden ? "show" : "hide";
  });

  label.append(tag, " ", toggle);
  commtext.style.display = "none";
  commtext.before(label);
}

function addSpinner(row: HTMLTableRowElement): void {
  const head = row.querySelector(".comhead");
  if (!head || head.querySelector(".hn-analyzing-spinner")) return;
  const spinner = document.createElement("span");
  spinner.className = "hn-analyzing-spinner";
  spinner.title = "Analyzing with AI...";
  head.append(spinner);
}

function removeSpinner(row: HTMLTableRowElement): void {
  const spinner = row.querySelector(".hn-analyzing-spinner");
  if (spinner) spinner.remove();
}

function updateSummaryBar(): void {
  if (filterStats.total === 0) {
    removeSummaryBar();
    return;
  }

  let bar = document.querySelector<HTMLElement>(".hn-filter-summary");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "hn-filter-summary";

    const text = document.createElement("span");
    text.className = "hn-filter-summary-text";
    bar.append(text);

    const close = document.createElement("button");
    close.className = "hn-filter-summary-close";
    close.textContent = "\u00D7";
    close.title = "Dismiss";
    close.addEventListener("click", () => { bar?.remove(); });
    bar.append(close);

    document.body.append(bar);
  }

  const text = bar.querySelector(".hn-filter-summary-text");
  if (!text) return;

  const categoryParts: string[] = [];
  const sorted = [...filterStats.byCategory.entries()].toSorted((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    const label = CATEGORY_LABELS[cat] ?? cat;
    categoryParts.push(`${String(count)} ${label}`);
  }

  text.textContent = `Filtered ${String(filterStats.total)} comment${filterStats.total === 1 ? "" : "s"} \u2014 ${categoryParts.join(", ")}`;
}

function removeSummaryBar(): void {
  document.querySelector(".hn-filter-summary")?.remove();
}

function resetStats(): void {
  filterStats.total = 0;
  filterStats.bySource.regex = 0;
  filterStats.bySource.llm = 0;
  filterStats.byCategory.clear();
}

function clearAllSentimentMarkers(): void {
  resetStats();
  removeSummaryBar();
  const rows = document.querySelectorAll<HTMLTableRowElement>("[data-hn-sentiment]");
  for (const row of rows) {
    delete row.dataset.hnSentiment;

    // Undo inline styles
    row.style.opacity = "";
    row.style.transition = "";
    row.style.display = "";

    // Remove hover listeners
    const listeners = hoverListeners.get(row);
    if (listeners) {
      row.removeEventListener("mouseenter", listeners.enter);
      row.removeEventListener("mouseleave", listeners.leave);
      hoverListeners.delete(row);
    }

    // Remove spinner and label, restore commtext
    removeSpinner(row);
    const label = row.querySelector(".hn-sentiment-label");
    if (label) label.remove();

    const commtext = row.querySelector("span.commtext, div.commtext");
    if (commtext instanceof HTMLElement) {
      commtext.style.display = "";
    }
  }
}
