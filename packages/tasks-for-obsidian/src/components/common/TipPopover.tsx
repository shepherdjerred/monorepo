import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";

type TipPopoverProps = {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
  position?: "above" | "below" | undefined;
};

export function TipPopover({
  visible,
  title,
  message,
  onDismiss,
  position = "below",
}: TipPopoverProps) {
  const { colors } = useSettings();
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 250 });
  }, [visible, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!visible) return null;

  const isAbove = position === "above";

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
        animatedStyle,
      ]}
    >
      <View
        style={[
          styles.arrow,
          isAbove ? styles.arrowBottom : styles.arrowTop,
          {
            borderBottomColor: isAbove ? "transparent" : colors.surfaceElevated,
            borderTopColor: isAbove ? colors.surfaceElevated : "transparent",
          },
        ]}
      />
      <Text style={[typography.subheading, { color: colors.text }]}>
        {title}
      </Text>
      <Text
        style={[
          typography.bodySmall,
          styles.message,
          { color: colors.textSecondary },
        ]}
      >
        {message}
      </Text>
      <Pressable
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss tip"
      >
        <Text style={styles.buttonText}>Got it</Text>
      </Pressable>
    </Animated.View>
  );
}

const ARROW_SIZE = 8;

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  arrow: {
    position: "absolute",
    alignSelf: "center",
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_SIZE,
    borderRightWidth: ARROW_SIZE,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  arrowTop: {
    top: -ARROW_SIZE,
    borderBottomWidth: ARROW_SIZE,
  },
  arrowBottom: {
    bottom: -ARROW_SIZE,
    borderTopWidth: ARROW_SIZE,
  },
  message: {
    marginTop: 4,
  },
  button: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});
