import React, { useEffect } from "react";
import { Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSync } from "../../hooks/useSync";

const BANNER_HEIGHT = 24;

export function ConnectionBanner() {
  const { isConnected, isSyncing } = useSync();
  const visible = !isConnected || isSyncing;

  const height = useSharedValue(visible ? BANNER_HEIGHT : 0);

  useEffect(() => {
    height.value = withTiming(visible ? BANNER_HEIGHT : 0, {
      duration: 150,
      easing: Easing.ease,
    });
  }, [visible, height]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
    overflow: "hidden" as const,
  }));

  const message = !isConnected ? "No connection" : "Syncing...";
  const backgroundColor = !isConnected ? "#ef4444" : "#f59e0b";

  return (
    <Animated.View style={[styles.banner, { backgroundColor }, animatedStyle]}>
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
