import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { colors } from "../styles/colors";

interface FREQuickStartScreenProps {
  onComplete: () => void;
  onBack: () => void;
  onCreateSession: () => void;
}

const quickStartSteps = [
  {
    id: 1,
    title: "Create your first session",
    description: "Set up a development environment with your repository",
  },
  {
    id: 2,
    title: "Attach to the console",
    description: "Access your session's terminal and start coding",
  },
  {
    id: 3,
    title: "Try the chat interface",
    description: "Interact with Claude AI to get coding assistance",
  },
];

export function FREQuickStartScreen({
  onComplete,
  onBack,
  onCreateSession,
}: FREQuickStartScreenProps) {
  return (
    <View style={styles.container}>
      {/* Title */}
      <Text style={styles.title}>Quick Start Guide</Text>
      <Text style={styles.subtitle}>Ready to begin? Here's your first steps:</Text>

      {/* Checklist */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {quickStartSteps.map((step) => (
          <View key={step.id} style={styles.stepCard}>
            <View style={styles.checkbox} />
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDescription}>{step.description}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.buttonOutline]}
          onPress={onBack}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonOutlineText}>← Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary]}
          onPress={onCreateSession}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonPrimaryText}>Create Session</Text>
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
    marginBottom: 8,
    ...Platform.select({
      ios: { fontFamily: "System" },
      android: { fontFamily: "Roboto" },
    }),
  },
  subtitle: {
    fontSize: 18,
    color: colors.textLight,
    textAlign: "center",
    marginBottom: 32,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  stepCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 20,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: 16,
    marginTop: 2,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 14,
    color: colors.textLight,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: colors.border,
  },
  buttonOutline: {
    backgroundColor: colors.surface,
  },
  buttonPrimary: {
    backgroundColor: colors.text,
  },
  buttonPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textWhite,
    textAlign: "center",
  },
  buttonOutlineText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
});
