import React, { useEffect } from "react";
import { Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSync } from "../../hooks/use-sync";
import { useTaskContext } from "../../state/TaskContext";

const BANNER_HEIGHT = 24;

export function ConnectionBanner() {
  const { isConnected, isAuthenticated, isSyncing } = useSync();
  const { pendingMutationCount, deadLetters } = useTaskContext();
  const insets = useSafeAreaInsets();
  const visible =
    !isConnected || !isAuthenticated || isSyncing || deadLetters.length > 0;

  const totalHeight = BANNER_HEIGHT + insets.top;
  const height = useSharedValue(visible ? totalHeight : 0);

  useEffect(() => {
    height.value = withTiming(visible ? totalHeight : 0, {
      duration: 150,
      easing: Easing.ease,
    });
  }, [visible, height, totalHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
    overflow: "hidden" as const,
  }));

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
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor, paddingTop: insets.top },
        animatedStyle,
      ]}
      accessibilityRole="alert"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      testID="connection-banner"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
});
