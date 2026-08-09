import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSync } from "../../hooks/use-sync";
import { useSettings } from "../../hooks/use-settings";
import { useTaskContext } from "../../state/TaskContext";
import { typography } from "../../styles/typography";
import { AppIcon } from "./AppIcon";

export function ConnectionBanner() {
  const { isConnected, isAuthenticated, isSyncing } = useSync();
  const { colors } = useSettings();
  const { pendingMutationCount, deadLetters } = useTaskContext();
  const insets = useSafeAreaInsets();
  const visible =
    !isConnected || !isAuthenticated || isSyncing || deadLetters.length > 0;

  // Conditional render, not an animated height: the reanimated collapse left
  // the banner permanently expanded (worklet style never applied), showing a
  // stale "Syncing..." bar over healthy state. Unmounting cannot get stuck.
  if (!visible) return null;

  let message: string;
  let backgroundColor = colors.surfaceElevated;
  let foregroundColor = colors.textSecondary;
  let icon: "alert-triangle" | "refresh-cw" | "wifi-off" = "wifi-off";
  if (!isConnected) {
    message =
      pendingMutationCount > 0
        ? `Offline · ${String(pendingMutationCount)} ${
            pendingMutationCount === 1 ? "change" : "changes"
          } queued`
        : "Offline";
  } else if (!isAuthenticated) {
    message = "Invalid auth token — check Settings";
    backgroundColor = colors.error;
    foregroundColor = colors.textInverse;
    icon = "alert-triangle";
  } else if (deadLetters.length > 0) {
    message = `${String(deadLetters.length)} ${
      deadLetters.length === 1 ? "change" : "changes"
    } failed to sync — review in Settings`;
    backgroundColor = colors.error;
    foregroundColor = colors.textInverse;
    icon = "alert-triangle";
  } else {
    message = "Syncing…";
    foregroundColor = colors.textSecondary;
    icon = "refresh-cw";
  }

  return (
    <View
      style={[styles.banner, { backgroundColor, paddingTop: insets.top }]}
      accessibilityRole="alert"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      testID="connection-banner"
    >
      <View
        style={styles.content}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <AppIcon name={icon} size={13} color={foregroundColor} />
        <Text
          style={[typography.caption, styles.text, { color: foregroundColor }]}
        >
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 28,
    paddingHorizontal: 16,
    paddingBottom: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  text: {
    fontWeight: "600",
  },
});
