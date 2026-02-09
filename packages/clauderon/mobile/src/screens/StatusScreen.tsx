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
import { CredentialRow } from "../components/CredentialRow";
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCredentialSave = useCallback(
    async (serviceId: string, value: string) => {
      if (!client) return;
      await client.updateCredential(serviceId, value);
      await loadStatus(); // Refresh to show updated status
    },
    [client, loadStatus],
  );

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
      {/* Credentials Section */}
      <View style={styles.section}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.textDark, borderBottomColor: colors.border },
          ]}
        >
          Credentials
        </Text>
        {status?.credentials.map((credential) => (
          <CredentialRow
            key={credential.service_id}
            credential={credential}
            onSave={handleCredentialSave}
          />
        ))}
      </View>

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

      {/* Proxies Section */}
      <View style={styles.section}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.textDark, borderBottomColor: colors.border },
          ]}
        >
          Proxies
        </Text>
        {status?.proxies.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textLight }]}>No active proxies</Text>
        ) : (
          status?.proxies.map((proxy) => (
            <View
              key={`${proxy.name}-${proxy.port}`}
              style={[styles.proxyRow, { borderBottomColor: colors.borderLight }]}
            >
              <View style={styles.proxyInfo}>
                <Text style={[styles.proxyName, { color: colors.textDark }]}>{proxy.name}</Text>
                <Text style={[styles.proxyMeta, { color: colors.textLight }]}>
                  Port {proxy.port} - {proxy.proxy_type}
                </Text>
              </View>
              <View
                style={[
                  styles.proxyStatus,
                  { borderColor: colors.border },
                  { backgroundColor: proxy.active ? colors.success : colors.surface },
                ]}
              >
                <Text
                  style={[
                    styles.proxyStatusText,
                    { color: proxy.active ? colors.textWhite : colors.textDark },
                  ]}
                >
                  {proxy.active ? "Active" : "Inactive"}
                </Text>
              </View>
            </View>
          ))
        )}
        {status && status.active_session_proxies > 0 && (
          <Text style={[styles.sessionProxyCount, { color: colors.textLight }]}>
            {status.active_session_proxies} session-specific{" "}
            {status.active_session_proxies === 1 ? "proxy" : "proxies"} active
          </Text>
        )}
      </View>
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
  emptyText: {
    fontSize: typography.fontSize.base,
  },
  proxyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  proxyInfo: {
    flex: 1,
  },
  proxyName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
  },
  proxyMeta: {
    fontSize: typography.fontSize.xs,
    marginTop: 2,
  },
  proxyStatus: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
  },
  proxyStatusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  sessionProxyCount: {
    fontSize: typography.fontSize.sm,
    marginTop: 12,
  },
});
