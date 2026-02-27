import React, { Component } from "react";
import { View, Text, Pressable, Appearance, StyleSheet } from "react-native";
import type { ReactNode, ErrorInfo } from "react";
import * as Sentry from "@sentry/react-native";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      const isDark = Appearance.getColorScheme() === "dark";
      const themeColors = isDark
        ? { background: "#111827", title: "#f9fafb", message: "#9ca3af", button: "#6366f1" }
        : { background: "#ffffff", title: "#111827", message: "#6b7280", button: "#6366f1" };

      return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
          <Text style={[styles.title, { color: themeColors.title }]}>Something went wrong</Text>
          <Text style={[styles.message, { color: themeColors.message }]}>
            {this.state.error?.message ?? "An unexpected error occurred"}
          </Text>
          <Pressable style={[styles.button, { backgroundColor: themeColors.button }]} onPress={this.handleRetry} accessibilityRole="button" accessibilityLabel="Try again">
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
