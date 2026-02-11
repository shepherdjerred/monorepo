#!/usr/bin/env bun

import { $ } from "bun";

interface RestoreStatus {
  phase: string;
  itemsRestored: number;
  totalItems: number;
  startTime: string;
  completedTime?: string;
}

async function getRestoreStatus(restoreName: string): Promise<RestoreStatus | null> {
  try {
    const result = await $`kubectl get restore ${restoreName} -n velero -o json`.quiet();
    const restore = JSON.parse(result.text());

    return {
      phase: restore.status?.phase || "Unknown",
      itemsRestored: restore.status?.progress?.itemsRestored || 0,
      totalItems: restore.status?.progress?.totalItems || 0,
      startTime: restore.status?.startTimestamp || restore.metadata?.creationTimestamp || "",
      completedTime: restore.status?.completionTimestamp,
    };
  } catch (error) {
    return null;
  }
}

function formatDuration(startTime: string, endTime?: string): string {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const duration = Math.floor((end.getTime() - start.getTime()) / 1000);

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

function drawProgressBar(current: number, total: number, width: number = 40): string {
  if (total === 0) return "[" + " ".repeat(width) + "] 0%";

  const percentage = Math.min(100, Math.floor((current / total) * 100));
  const filled = Math.floor((current / total) * width);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${percentage}%`;
}

async function showLogs(restoreName: string) {
  console.log("\n📋 Restore Logs:\n");
  try {
    await $`velero restore logs ${restoreName}`;
  } catch (error) {
    console.log("❌ Could not retrieve logs");
  }
}

async function monitorRestore(restoreName: string) {
  console.log(`🔍 Monitoring Velero restore: ${restoreName}\n`);

  let previousPhase = "";
  let previousItems = -1;

  while (true) {
    const status = await getRestoreStatus(restoreName);

    if (!status) {
      console.log("❌ Could not find restore:", restoreName);
      process.exit(1);
    }

    // Clear previous line if we're updating progress
    if (previousItems >= 0) {
      process.stdout.write("\x1b[2K\r"); // Clear line
    }

    const duration = formatDuration(status.startTime, status.completedTime);
    const progressBar = drawProgressBar(status.itemsRestored, status.totalItems);

    // Show status
    const phaseEmoji =
      status.phase === "Completed"
        ? "✅"
        : status.phase === "Failed"
          ? "❌"
          : status.phase === "FailedValidation"
            ? "⚠️"
            : "⏳";

    if (status.phase !== previousPhase) {
      console.log(`\n${phaseEmoji} Phase: ${status.phase}`);
    }

    console.log(`${progressBar} ${status.itemsRestored}/${status.totalItems} items | Duration: ${duration}`);

    previousPhase = status.phase;
    previousItems = status.itemsRestored;

    // Check if restore is complete
    if (status.phase === "Completed") {
      console.log("\n✅ Restore completed successfully!");
      await showLogs(restoreName);
      break;
    } else if (status.phase === "Failed" || status.phase === "FailedValidation") {
      console.log("\n❌ Restore failed!");
      await showLogs(restoreName);
      process.exit(1);
    }

    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  // Try to find the most recent restore
  try {
    const result = await $`kubectl get restores -n velero --sort-by=.metadata.creationTimestamp -o json`.quiet();
    const restores = JSON.parse(result.text());

    if (restores.items && restores.items.length > 0) {
      const latestRestore = restores.items[restores.items.length - 1];
      console.log(`No restore name provided, using latest: ${latestRestore.metadata.name}\n`);
      await monitorRestore(latestRestore.metadata.name);
    } else {
      console.log("❌ No restores found");
      console.log("\nUsage: bun run scripts/velero/monitor-restore.ts <restore-name>");
      process.exit(1);
    }
  } catch (error) {
    console.log("❌ Error finding restores");
    console.log("\nUsage: bun run scripts/velero/monitor-restore.ts <restore-name>");
    process.exit(1);
  }
} else {
  await monitorRestore(args[0]);
}
