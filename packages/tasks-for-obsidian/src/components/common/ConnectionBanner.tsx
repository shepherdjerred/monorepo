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

const BANNER_HEIGHT = 24;

export function ConnectionBanner() {
  const { isConnected, isSyncing } = useSync();
  const insets = useSafeAreaInsets();
  const visible = !isConnected || isSyncing;

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

  const message = isConnected ? "Syncing..." : "No connection";
  const backgroundColor = isConnected ? "#f59e0b" : "#ef4444";

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
