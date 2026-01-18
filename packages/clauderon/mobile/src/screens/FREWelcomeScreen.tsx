import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from "react-native";
import { colors } from "../styles/colors";

interface FREWelcomeScreenProps {
  onNext: () => void;
}

export function FREWelcomeScreen({ onNext }: FREWelcomeScreenProps) {
  return (
    <View style={styles.container}>
      {/* Logo/Title */}
      <View style={styles.header}>
        <Text style={styles.logo}>CLAUDERON</Text>
        <Text style={styles.tagline}>Development environments, on demand</Text>
      </View>

      {/* Description */}
      <View style={styles.content}>
        <Text style={styles.description}>
          Clauderon creates isolated development environments powered by Claude
          AI. Work with your code in containerized sessions with intelligent
          assistance.
        </Text>
        <Text style={styles.description}>
          Each session includes a full terminal, file system, and AI assistant
          to help you build, debug, and deploy your applications.
        </Text>
      </View>

      {/* CTA Button */}
      <TouchableOpacity
        style={styles.button}
        onPress={onNext}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>Get Started →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  logo: {
    fontSize: 48,
    fontWeight: "900",
    color: colors.text,
    letterSpacing: 2,
    marginBottom: 16,
    ...Platform.select({
      ios: { fontFamily: "System" },
      android: { fontFamily: "Roboto" },
    }),
  },
  tagline: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.primary,
    textAlign: "center",
  },
  content: {
    marginBottom: 48,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
    textAlign: "center",
    marginBottom: 16,
  },
  button: {
    backgroundColor: colors.text,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 0,
    borderWidth: 3,
    borderColor: colors.border,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textWhite,
    textAlign: "center",
  },
});
