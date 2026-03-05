import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "../../hooks/use-settings";
import { feedbackButtonPress } from "../../lib/feedback";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type FabProps = {
  onPress: () => void;
};

export function Fab({ onPress }: FabProps) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.92, { damping: 15, stiffness: 600 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 12, stiffness: 400 });
    feedbackButtonPress();
  };

  return (
    <AnimatedPressable
      style={[
        styles.fab,
        { backgroundColor: colors.primary, bottom: 20 + insets.bottom },
        animatedStyle,
      ]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel="Quick add task"
    >
      <Text style={styles.text}>+</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  text: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "400",
    lineHeight: 30,
  },
});
