import { fetchItem, fetchUser } from "#src/lib/hn-api.ts";
import {
  getLocalState,
  getSettings,
  pruneOldLLMCache,
  setLocalState,
} from "#src/lib/storage.ts";

const ALARM_NAME = "poll-replies";

chrome.runtime.onInstalled.addListener(() => {
  void setupAlarm();
  void pruneOldLLMCache();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void pollForReplies();
  }
});

async function setupAlarm(): Promise<void> {
  const settings = await getSettings();
  const intervalMinutes = settings.replyNotifier.pollIntervalMinutes;

  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: Math.max(1, intervalMinutes),
  });
}

async function pollForReplies(): Promise<void> {
  const settings = await getSettings();
  if (!settings.replyNotifier.enabled || !settings.replyNotifier.myUsername)
    return;

  const username = settings.replyNotifier.myUsername;
  const localState = await getLocalState();

  const user = await fetchUser(username);
  if (!user?.submitted) return;

  // Get the user's most recent comment IDs (not stories)
  const recentIds = user.submitted.slice(0, 30);
  const items = await Promise.all(recentIds.map((id) => fetchItem(id)));

  const myComments = items.filter(
    (item) => item?.type === "comment" && item.by === username,
  );

  // For each of user's comments, check for new replies in `kids`
  let newReplies = 0;
  const highestSeenId = localState.lastSeenItemId;
  let newHighestId = highestSeenId;

  for (const comment of myComments) {
    if (!comment?.kids) continue;

    for (const kidId of comment.kids) {
      if (kidId > highestSeenId) {
        // Verify it's actually a reply (not our own comment)
        const kid = await fetchItem(kidId);
        if (kid && kid.by !== username) {
          newReplies++;
        }
        if (kidId > newHighestId) {
          newHighestId = kidId;
        }
      }
    }
  }

  await setLocalState({
    replyCount: localState.replyCount + newReplies,
    lastSeenItemId: newHighestId,
    lastPolledAt: Date.now(),
  });
}
