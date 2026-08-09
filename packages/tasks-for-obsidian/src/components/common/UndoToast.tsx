import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { UNDO_TOAST_MS } from "../../domain/task-toggle";
import { e2eUndoToastMs } from "../../navigation/e2e-config";

type Props = {
  visible: boolean;
  requestId: number | null;
  depth: number;
  message: string;
  undoInFlight: boolean;
  onUndo: () => void;
  onDismiss: () => void;
};

/**
 * Transient bottom toast with a single Undo action and a shrinking time
 * bar for its lifetime. The provider keeps this view mounted while the active
 * LIFO entry changes, so rapid completions reset the timer without replaying
 * the entrance motion.
 */
export function UndoToast({
  visible,
  requestId,
  depth,
  message,
  undoInFlight,
  onUndo,
  onDismiss,
}: Props) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(1);
  const duration = e2eUndoToastMs(UNDO_TOAST_MS);

  useEffect(() => {
    if (!visible) return;
    if (undoInFlight) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 1;
    if (!reducedMotion) {
      progress.value = withTiming(0, {
        duration,
        easing: Easing.linear,
      });
    }
    const timer = setTimeout(onDismiss, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [
    duration,
    visible,
    requestId,
    onDismiss,
    progress,
    reducedMotion,
    undoInFlight,
  ]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      entering={
        reducedMotion
          ? FadeIn.duration(120)
          : FadeInDown.duration(180).easing(Easing.out(Easing.cubic))
      }
      exiting={
        reducedMotion
          ? FadeOut.duration(100)
          : FadeOutDown.duration(140).easing(Easing.in(Easing.cubic))
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
          testID="undo-toast-message"
        >
          {message}
        </Text>
        <Pressable
          style={styles.undoButton}
          onPress={onUndo}
          disabled={undoInFlight}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            depth > 1
              ? `Undo latest completion, ${String(depth)} available`
              : "Undo"
          }
          testID="undo-toast-action"
        >
          <Text
            style={[
              typography.body,
              styles.undo,
              { color: colors.primary, opacity: undoInFlight ? 0.5 : 1 },
            ]}
          >
            {depth > 1 ? `Undo (${String(depth)})` : "Undo"}
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
    zIndex: 1000,
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
  undoButton: {
    minHeight: 44,
    justifyContent: "center",
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
