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
import { CredentialRow } from "../components/CredentialRow";
import { UsageProgressBar } from "../components/UsageProgressBar";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

type StatusScreenProps = RootStackScreenProps<"Status">;

export function StatusScreen(_props: StatusScreenProps) {
  const { client } = useSessionContext();
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
    [client, loadStatus]
  );

  if (isLoading) {
    return (
      <View style={commonStyles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading system status...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={commonStyles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={commonStyles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={loadStatus}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {/* Credentials Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Credentials</Text>
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
          <Text style={styles.sectionTitle}>Claude Code Usage</Text>
          {status.claude_usage.organization_name && (
            <Text style={styles.orgName}>
              {status.claude_usage.organization_name}
            </Text>
          )}

          {status.claude_usage.error ? (
            <View style={styles.usageError}>
              <Text style={styles.usageErrorTitle}>
                {status.claude_usage.error.error_type}
              </Text>
              <Text style={styles.usageErrorMessage}>
                {status.claude_usage.error.message}
              </Text>
              {status.claude_usage.error.suggestion && (
                <Text style={styles.usageErrorSuggestion}>
                  {status.claude_usage.error.suggestion}
                </Text>
              )}
            </View>
          ) : (
            <>
              <UsageProgressBar
                window={status.claude_usage.five_hour}
                title="5-Hour Window"
              />
              <UsageProgressBar
                window={status.claude_usage.seven_day}
                title="7-Day Window"
              />
              {status.claude_usage.seven_day_sonnet && (
                <UsageProgressBar
                  window={status.claude_usage.seven_day_sonnet}
                  title="7-Day Sonnet"
                />
              )}
            </>
          )}

          <Text style={styles.fetchedAt}>
            Updated: {new Date(status.claude_usage.fetched_at).toLocaleString()}
          </Text>
        </View>
      )}

      {/* Proxies Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Proxies</Text>
        {status?.proxies.length === 0 ? (
          <Text style={styles.emptyText}>No active proxies</Text>
        ) : (
          status?.proxies.map((proxy) => (
            <View key={`${proxy.name}-${proxy.port}`} style={styles.proxyRow}>
              <View style={styles.proxyInfo}>
                <Text style={styles.proxyName}>{proxy.name}</Text>
                <Text style={styles.proxyMeta}>
                  Port {proxy.port} - {proxy.proxy_type}
                </Text>
              </View>
              <View
                style={[
                  styles.proxyStatus,
                  proxy.active ? styles.proxyActive : styles.proxyInactive,
                ]}
              >
                <Text style={styles.proxyStatusText}>
                  {proxy.active ? "Active" : "Inactive"}
                </Text>
              </View>
            </View>
          ))
        )}
        {status && status.active_session_proxies > 0 && (
          <Text style={styles.sessionProxyCount}>
            {status.active_session_proxies} session-specific{" "}
            {status.active_session_proxies === 1 ? "proxy" : "proxies"} active
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  loadingText: {
    marginTop: 12,
    fontSize: typography.fontSize.base,
    color: colors.textLight,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    color: colors.error,
    textAlign: "center",
  },
  orgName: {
    fontSize: typography.fontSize.sm,
    color: colors.textLight,
    marginBottom: 12,
  },
  usageError: {
    backgroundColor: "#fef2f2",
    borderWidth: 2,
    borderColor: colors.error,
    padding: 12,
  },
  usageErrorTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.error,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  usageErrorMessage: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    marginBottom: 8,
  },
  usageErrorSuggestion: {
    fontSize: typography.fontSize.sm,
    color: colors.textLight,
    fontStyle: "italic",
  },
  fetchedAt: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
    marginTop: 12,
  },
  emptyText: {
    fontSize: typography.fontSize.base,
    color: colors.textLight,
  },
  proxyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  proxyInfo: {
    flex: 1,
  },
  proxyName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.textDark,
  },
  proxyMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
    marginTop: 2,
  },
  proxyStatus: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  proxyActive: {
    backgroundColor: colors.success,
  },
  proxyInactive: {
    backgroundColor: colors.surface,
  },
  proxyStatusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  sessionProxyCount: {
    fontSize: typography.fontSize.sm,
    color: colors.textLight,
    marginTop: 12,
  },
});
