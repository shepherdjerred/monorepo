import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";

export const UNDO_TOAST_MS = 5000;

type Props = {
  visible: boolean;
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
};

/**
 * Transient bottom toast with a single Undo action and a shrinking time
 * bar for its lifetime. Used for recurring-task completions — the one
 * mutation whose target (the occurrence date) is invisible in the UI.
 */
export function UndoToast({ visible, message, onUndo, onDismiss }: Props) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(1);

  useEffect(() => {
    if (!visible) return;
    progress.value = 1;
    if (!reducedMotion) {
      progress.value = withTiming(0, {
        duration: UNDO_TOAST_MS,
        easing: Easing.linear,
      });
    }
    const timer = setTimeout(onDismiss, UNDO_TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [visible, onDismiss, progress, reducedMotion]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      entering={
        reducedMotion
          ? FadeIn.duration(150)
          : SlideInDown.springify().damping(15)
      }
      exiting={
        reducedMotion ? FadeOut.duration(100) : SlideOutDown.duration(200)
      }
      style={[
        styles.toast,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          bottom: Math.max(insets.bottom, 16) + 56,
        },
      ]}
      testID="undo-toast"
    >
      <View style={styles.row}>
        <Text
          style={[typography.body, styles.message, { color: colors.text }]}
          numberOfLines={1}
        >
          {message}
        </Text>
        <Pressable
          onPress={onUndo}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          testID="undo-toast-action"
        >
          <Text
            style={[typography.body, styles.undo, { color: colors.primary }]}
          >
            Undo
          </Text>
        </Pressable>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.borderLight }]}>
        <Animated.View
          style={[styles.bar, { backgroundColor: colors.primary }, barStyle]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  message: {
    flex: 1,
  },
  undo: {
    fontWeight: "700",
  },
  barTrack: {
    height: 3,
    borderRadius: 1.5,
    marginTop: 8,
    overflow: "hidden",
  },
  bar: {
    height: 3,
    borderRadius: 1.5,
    transformOrigin: "left",
  },
});
