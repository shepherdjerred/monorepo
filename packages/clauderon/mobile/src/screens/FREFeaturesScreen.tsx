import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { colors } from "../styles/colors";

interface FREFeaturesScreenProps {
  onNext: () => void;
  onBack: () => void;
}

const features = [
  {
    icon: "📦",
    title: "Sessions",
    description:
      "Isolated development environments with full terminal access and file system. Create, manage, and switch between multiple sessions effortlessly.",
  },
  {
    icon: "🤖",
    title: "Agents",
    description:
      "Claude AI integration with multiple agent types. Choose from standard, advanced, or specialized agents to assist with your development tasks.",
  },
  {
    icon: "🖥️",
    title: "Backends",
    description:
      "Support for Docker, Kubernetes, and native containers. Deploy your sessions on the infrastructure that works best for your workflow.",
  },
  {
    icon: "⚡",
    title: "Real-time",
    description:
      "Live console access and real-time updates. See your code changes and terminal output instantly, with WebSocket-powered synchronization.",
  },
];

export function FREFeaturesScreen({
  onNext,
  onBack,
}: FREFeaturesScreenProps) {
  const [currentFeature, setCurrentFeature] = useState(0);

  const handlePrevious = () => {
    if (currentFeature > 0) {
      setCurrentFeature(currentFeature - 1);
    }
  };

  const handleNext = () => {
    if (currentFeature < features.length - 1) {
      setCurrentFeature(currentFeature + 1);
    } else {
      onNext();
    }
  };

  const feature = features[currentFeature];

  return (
    <View style={styles.container}>
      {/* Title */}
      <Text style={styles.title}>Key Features</Text>

      {/* Feature card */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.icon}>{feature.icon}</Text>
          <Text style={styles.featureTitle}>{feature.title}</Text>
          <Text style={styles.featureDescription}>{feature.description}</Text>
        </View>
      </ScrollView>

      {/* Page indicators */}
      <View style={styles.indicators}>
        {features.map((_, i) => (
          <View
            key={i}
            style={[
              styles.indicator,
              i === currentFeature && styles.indicatorActive,
            ]}
          />
        ))}
      </View>

      {/* Navigation buttons */}
      <View style={styles.navigation}>
        <TouchableOpacity
          style={[styles.navButton, styles.navButtonOutline]}
          onPress={onBack}
          activeOpacity={0.8}
        >
          <Text style={styles.navButtonOutlineText}>← Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navButton, styles.navButtonSecondary]}
          onPress={handlePrevious}
          disabled={currentFeature === 0}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.navButtonOutlineText,
              currentFeature === 0 && styles.navButtonDisabled,
            ]}
          >
            ←
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navButton, styles.navButtonPrimary]}
          onPress={handleNext}
          activeOpacity={0.8}
        >
          <Text style={styles.navButtonText}>
            {currentFeature < features.length - 1 ? "Next →" : "Continue →"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: colors.text,
    textAlign: "center",
    marginBottom: 32,
    ...Platform.select({
      ios: { fontFamily: "System" },
      android: { fontFamily: "Roboto" },
    }),
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    padding: 32,
    alignItems: "center",
    marginBottom: 24,
  },
  icon: {
    fontSize: 64,
    marginBottom: 24,
  },
  featureTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 16,
    textAlign: "center",
  },
  featureDescription: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
    textAlign: "center",
  },
  indicators: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.borderLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  indicatorActive: {
    backgroundColor: colors.text,
  },
  navigation: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  navButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: colors.border,
  },
  navButtonOutline: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  navButtonSecondary: {
    backgroundColor: colors.surface,
    minWidth: 48,
  },
  navButtonPrimary: {
    flex: 1,
    backgroundColor: colors.text,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textWhite,
    textAlign: "center",
  },
  navButtonOutlineText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
});
