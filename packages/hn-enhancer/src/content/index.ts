import "./content.css";
import { setDebugEnabled } from "#src/lib/debug.ts";
import { observeCommentTree } from "#src/lib/dom.ts";
import { pruneOldLLMCache } from "#src/lib/storage.ts";
import { getSettings, onSettingsChanged } from "#src/lib/storage.ts";
import {
  initGreenAccounts,
  processRows as processGreenRows,
  updateGreenAccountSettings,
} from "./green-accounts.ts";
import { initHideUser, processRows as processHideRows } from "./hide-user.ts";
import { initReplyNotifier } from "./reply-badge.ts";
import {
  initSentimentFilter,
  processRows as processSentimentRows,
  updateSentimentSettings,
} from "./sentiment-filter.ts";

async function main() {
  const settings = await getSettings();

  // Enable debug logging if configured
  setDebugEnabled(settings.debug);

  // Prune old LLM cache entries on startup
  void pruneOldLLMCache();

  // Initialize features
  initHideUser(settings);
  initReplyNotifier(settings);

  if (settings.sentimentFilter.enabled) {
    initSentimentFilter(settings);
  }

  if (settings.hideGreenAccounts.enabled) {
    initGreenAccounts(settings);
  }

  // Watch for new comment rows (HN lazy-loads / expands)
  observeCommentTree((addedRows) => {
    processHideRows(addedRows);
    if (settings.sentimentFilter.enabled) {
      processSentimentRows(addedRows);
    }
    if (settings.hideGreenAccounts.enabled) {
      processGreenRows(addedRows);
    }
  });

  // React to settings changes from popup
  onSettingsChanged((newSettings) => {
    setDebugEnabled(newSettings.debug);
    if (newSettings.sentimentFilter.enabled) {
      updateSentimentSettings(newSettings.sentimentFilter);
    }
    if (newSettings.hideGreenAccounts.enabled) {
      updateGreenAccountSettings(newSettings.hideGreenAccounts);
    }
  });
}

void main();
