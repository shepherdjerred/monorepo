import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import type { RootStackScreenProps } from "../types/navigation";
import type { SystemStatus } from "../types/generated";
import { useSessionContext } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { UsageProgressBar } from "../components/UsageProgressBar";
import { typography } from "../styles/typography";

const USAGE_ERROR_BACKGROUND = "#fef2f2";

type StatusScreenProps = RootStackScreenProps<"Status">;

export function StatusScreen(_props: StatusScreenProps) {
  const { client } = useSessionContext();
  const { colors } = useTheme();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!client) {
      setError("No daemon URL configured");
      setIsLoading(false);
      return;
    }

    setError(null);
    try {
      const systemStatus = await client.getSystemStatus();
      setStatus(systemStatus);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Failed to load status");
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textLight }]}>
          Loading system status...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex1, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={() => void loadStatus()}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {/* Usage Section */}
      {status?.claude_usage && (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.textDark, borderBottomColor: colors.border },
            ]}
          >
            Claude Code Usage
          </Text>
          {status.claude_usage.organization_name && (
            <Text style={[styles.orgName, { color: colors.textLight }]}>
              {status.claude_usage.organization_name}
            </Text>
          )}

          {status.claude_usage.error ? (
            <View style={[styles.usageError, { borderColor: colors.error }]}>
              <Text style={[styles.usageErrorTitle, { color: colors.error }]}>
                {status.claude_usage.error.error_type}
              </Text>
              <Text style={[styles.usageErrorMessage, { color: colors.text }]}>
                {status.claude_usage.error.message}
              </Text>
              {status.claude_usage.error.suggestion && (
                <Text style={[styles.usageErrorSuggestion, { color: colors.textLight }]}>
                  {status.claude_usage.error.suggestion}
                </Text>
              )}
            </View>
          ) : (
            <>
              <UsageProgressBar window={status.claude_usage.five_hour} title="5-Hour Window" />
              <UsageProgressBar window={status.claude_usage.seven_day} title="7-Day Window" />
              {status.claude_usage.seven_day_sonnet && (
                <UsageProgressBar
                  window={status.claude_usage.seven_day_sonnet}
                  title="7-Day Sonnet"
                />
              )}
            </>
          )}

          <Text style={[styles.fetchedAt, { color: colors.textLight }]}>
            Updated: {new Date(status.claude_usage.fetched_at).toLocaleString()}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 2,
  },
  loadingText: {
    marginTop: 12,
    fontSize: typography.fontSize.base,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    textAlign: "center",
  },
  orgName: {
    fontSize: typography.fontSize.sm,
    marginBottom: 12,
  },
  usageError: {
    backgroundColor: USAGE_ERROR_BACKGROUND,
    borderWidth: 2,
    padding: 12,
  },
  usageErrorTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  usageErrorMessage: {
    fontSize: typography.fontSize.base,
    marginBottom: 8,
  },
  usageErrorSuggestion: {
    fontSize: typography.fontSize.sm,
    fontStyle: "italic",
  },
  fetchedAt: {
    fontSize: typography.fontSize.xs,
    marginTop: 12,
  },
});
