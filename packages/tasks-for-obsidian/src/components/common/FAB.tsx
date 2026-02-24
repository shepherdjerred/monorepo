import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useSettings } from "../../hooks/useSettings";
import { feedbackButtonPress } from "../../lib/feedback";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type FABProps = {
  onPress: () => void;
};

export function FAB({ onPress }: FABProps) {
  const { colors } = useSettings();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.92, { damping: 15, stiffness: 600 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1.0, { damping: 12, stiffness: 400 });
    feedbackButtonPress();
  };

  return (
    <AnimatedPressable
      style={[styles.fab, { backgroundColor: colors.primary }, animatedStyle]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Text style={styles.text}>+</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
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
