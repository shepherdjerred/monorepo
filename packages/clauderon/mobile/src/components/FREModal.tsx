import React, { useState, useRef } from "react";
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Text,
  Dimensions,
  Platform,
  PanResponder,
} from "react-native";
import { FREWelcomeScreen } from "../screens/FREWelcomeScreen";
import { FREFeaturesScreen } from "../screens/FREFeaturesScreen";
import { FREQuickStartScreen } from "../screens/FREQuickStartScreen";
import { colors } from "../styles/colors";

interface FREModalProps {
  visible: boolean;
  onComplete: () => void;
  onSkip: () => void;
  onCreateSession: () => void;
}

const SWIPE_THRESHOLD = 50;

export function FREModal({
  visible,
  onComplete,
  onSkip,
  onCreateSession,
}: FREModalProps) {
  const [currentScreen, setCurrentScreen] = useState(0);
  const totalScreens = 3;

  const handleNext = () => {
    if (currentScreen < totalScreens - 1) {
      setCurrentScreen(currentScreen + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentScreen > 0) {
      setCurrentScreen(currentScreen - 1);
    }
  };

  const handleCreateSession = () => {
    onComplete();
    onCreateSession();
  };

  // Swipe gesture handling
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderRelease: (_, gestureState) => {
        // Swipe left = next
        if (gestureState.dx < -SWIPE_THRESHOLD && currentScreen < totalScreens - 1) {
          handleNext();
        }
        // Swipe right = back
        else if (gestureState.dx > SWIPE_THRESHOLD && currentScreen > 0) {
          handleBack();
        }
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View style={styles.container} {...panResponder.panHandlers}>
        {/* Skip button */}
        <TouchableOpacity
          style={styles.skipButton}
          onPress={onSkip}
          activeOpacity={0.8}
        >
          <Text style={styles.skipText}>Skip ✕</Text>
        </TouchableOpacity>

        {/* Screen content */}
        <View style={styles.content}>
          {currentScreen === 0 && <FREWelcomeScreen onNext={handleNext} />}
          {currentScreen === 1 && (
            <FREFeaturesScreen onNext={handleNext} onBack={handleBack} />
          )}
          {currentScreen === 2 && (
            <FREQuickStartScreen
              onComplete={onComplete}
              onBack={handleBack}
              onCreateSession={handleCreateSession}
            />
          )}
        </View>

        {/* Step indicator */}
        <View style={styles.stepIndicator}>
          {Array.from({ length: totalScreens }, (_, i) => (
            <View
              key={i}
              style={[
                styles.stepDot,
                i === currentScreen && styles.stepDotActive,
              ]}
            />
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skipButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 20,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  skipText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  content: {
    flex: 1,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
  },
  stepIndicator: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.borderLight,
    borderWidth: 2,
    borderColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.text,
  },
});
