import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTaskContext } from "../../state/TaskContext";
import { useTimeTrackingContext } from "../../state/TimeTrackingContext";
import * as liveActivity from "../../native/live-activity-bridge";
import { elapsedSecondsSince } from "../../lib/elapsed";
import { TimeTrackingBar } from "./TimeTrackingBar";

const TICK_INTERVAL_MS = 1000;
const TAB_BAR_OFFSET = 56;

export function ActiveTimeTrackingOverlay(): React.ReactElement | null {
  const { activeEntry, stopTracking } = useTimeTrackingContext();
  const { tasks } = useTaskContext();
  const insets = useSafeAreaInsets();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const lastBridgeStartIdRef = useRef<string | null>(null);

  // Live elapsed counter while an entry is active.
  useEffect(() => {
    if (activeEntry === null) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(elapsedSecondsSince(activeEntry.startTime));
    const interval = setInterval(() => {
      setElapsedSeconds(elapsedSecondsSince(activeEntry.startTime));
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [activeEntry]);

  // Bridge to iOS Live Activity / Dynamic Island. No-op on Android.
  useEffect(() => {
    if (activeEntry === null) {
      const wasActiveId = lastBridgeStartIdRef.current;
      if (wasActiveId !== null) {
        lastBridgeStartIdRef.current = null;
        void liveActivity.stopTimeTracking(elapsedSeconds);
      }
      return;
    }
    const taskIdStr = String(activeEntry.taskId);
    if (lastBridgeStartIdRef.current !== taskIdStr) {
      lastBridgeStartIdRef.current = taskIdStr;
      const task = tasks.get(activeEntry.taskId);
      const title = task?.title ?? "Task";
      const project = task?.projects[0];
      void liveActivity.startTimeTracking(taskIdStr, title, project);
    }
  }, [activeEntry, elapsedSeconds, tasks]);

  // Push live duration to the activity once per second when active.
  useEffect(() => {
    if (activeEntry === null) return;
    void liveActivity.updateTimeTracking(elapsedSeconds, false);
  }, [activeEntry, elapsedSeconds]);

  if (activeEntry === null) return null;

  const task = tasks.get(activeEntry.taskId);
  const title = task?.title ?? "Tracking";

  const handleStop = (): void => {
    void stopTracking(activeEntry.taskId);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: insets.bottom + TAB_BAR_OFFSET }]}
    >
      <TimeTrackingBar
        taskTitle={title}
        elapsedSeconds={elapsedSeconds}
        onStop={handleStop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
