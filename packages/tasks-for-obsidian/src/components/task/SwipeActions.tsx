import React from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  interpolate,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { AppIcon } from "../common/AppIcon";
import { useSettings } from "../../hooks/use-settings";

const ACTION_WIDTH = 80;

type SwipeActionProps = {
  progress: SharedValue<number>;
};

export function LeftSwipeActions({ progress }: SwipeActionProps) {
  const { colors } = useSettings();

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 0.5, 1], [0.5, 0.8, 1]);
    const opacity = interpolate(progress.value, [0, 0.5, 1], [0, 0.5, 1]);
    return { transform: [{ scale }], opacity };
  });

  return (
    <Animated.View
      style={[
        styles.action,
        styles.leftAction,
        { backgroundColor: colors.success },
      ]}
    >
      <Animated.View style={animatedStyle}>
        <AppIcon name="check" size={24} color="#fff" />
      </Animated.View>
    </Animated.View>
  );
}

export function RightSwipeActions({ progress }: SwipeActionProps) {
  const { colors } = useSettings();

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 0.5, 1], [0.5, 0.8, 1]);
    const opacity = interpolate(progress.value, [0, 0.5, 1], [0, 0.5, 1]);
    return { transform: [{ scale }], opacity };
  });

  return (
    <Animated.View
      style={[
        styles.action,
        styles.rightAction,
        { backgroundColor: colors.error },
      ]}
    >
      <Animated.View style={animatedStyle}>
        <AppIcon name="trash-2" size={24} color="#fff" />
      </Animated.View>
    </Animated.View>
  );
}

export { ACTION_WIDTH };

const styles = StyleSheet.create({
  action: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
  leftAction: {
    borderRadius: 0,
  },
  rightAction: {
    borderRadius: 0,
  },
});
