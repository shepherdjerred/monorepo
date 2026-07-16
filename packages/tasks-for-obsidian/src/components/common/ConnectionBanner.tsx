import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSync } from "../../hooks/use-sync";
import { useTaskContext } from "../../state/TaskContext";

export function ConnectionBanner() {
  const { isConnected, isAuthenticated, isSyncing } = useSync();
  const { pendingMutationCount, deadLetters } = useTaskContext();
  const insets = useSafeAreaInsets();
  const visible =
    !isConnected || !isAuthenticated || isSyncing || deadLetters.length > 0;

  // Conditional render, not an animated height: the reanimated collapse left
  // the banner permanently expanded (worklet style never applied), showing a
  // stale "Syncing..." bar over healthy state. Unmounting cannot get stuck.
  if (!visible) return null;

  let message: string;
  let backgroundColor: string;
  if (!isConnected) {
    message =
      pendingMutationCount > 0
        ? `Offline — ${String(pendingMutationCount)} ${
            pendingMutationCount === 1 ? "change" : "changes"
          } queued`
        : "No connection";
    backgroundColor = "#ef4444";
  } else if (!isAuthenticated) {
    message = "Invalid auth token — check Settings";
    backgroundColor = "#ef4444";
  } else if (deadLetters.length > 0) {
    message = `${String(deadLetters.length)} ${
      deadLetters.length === 1 ? "change" : "changes"
    } failed to sync — review in Settings`;
    backgroundColor = "#ef4444";
  } else {
    message = "Syncing...";
    backgroundColor = "#f59e0b";
  }

  return (
    <View
      style={[styles.banner, { backgroundColor, paddingTop: insets.top }]}
      accessibilityRole="alert"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      testID="connection-banner"
    >
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
});
