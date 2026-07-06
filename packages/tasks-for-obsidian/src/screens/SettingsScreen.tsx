import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Switch,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { z } from "zod";
import type { RootStackParamList } from "../navigation/types";
import type { Command } from "../data/sync/commands";
import { useSettings } from "../hooks/use-settings";
import { useTaskContext } from "../state/TaskContext";
import { typography } from "../styles/typography";

function describeCommand(command: Command): string {
  switch (command.type) {
    case "create":
      return `Create "${command.payload.title}"`;
    case "update":
      return `Edit ${String(command.taskId)}`;
    case "delete":
      return `Delete ${String(command.taskId)}`;
    case "set_status":
      return `Mark ${String(command.taskId)} as ${command.status}`;
    case "set_instance_complete":
      return command.completed
        ? `Complete ${String(command.taskId)} for ${command.date}`
        : `Un-complete ${String(command.taskId)} for ${command.date}`;
  }
}

const HealthCheckSchema = z.object({
  authenticated: z.boolean().optional(),
});

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

export function SettingsScreen(_props: Props) {
  const {
    colors,
    isDarkMode,
    feedbackEnabled,
    apiUrl,
    authToken,
    setApiUrl,
    setAuthToken,
    setIsDarkMode,
    setFeedbackEnabled,
  } = useSettings();
  const {
    pendingMutationCount,
    deadLetters,
    retryDeadLetter,
    discardDeadLetter,
  } = useTaskContext();
  const [testStatus, setTestStatus] = useState<string | null>(null);

  const handleTestConnection = useCallback(() => {
    void (async () => {
      setTestStatus("Testing...");
      try {
        const headers: Record<string, string> = {};
        if (authToken) {
          headers["Authorization"] = `Bearer ${authToken}`;
        }
        const response = await fetch(`${apiUrl}/api/health`, { headers });
        if (!response.ok) {
          setTestStatus(`Error: ${response.status}`);
          return;
        }
        const json: unknown = await response.json();
        const body = HealthCheckSchema.parse(json);
        if (body.authenticated === false) {
          setTestStatus("Connected, but token is invalid");
        } else {
          setTestStatus("Connected");
        }
      } catch {
        setTestStatus("Failed to connect");
      }
    })();
  }, [apiUrl, authToken]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>
          API URL
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
          value={apiUrl}
          onChangeText={(text) => {
            void setApiUrl(text);
          }}
          placeholder="http://localhost:8080"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          testID="settings-api-url"
          accessibilityLabel="API URL"
        />

        <Text
          style={[
            typography.label,
            { color: colors.textSecondary },
            styles.sectionLabel,
          ]}
        >
          Auth Token
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
          value={authToken}
          onChangeText={(text) => {
            void setAuthToken(text);
          }}
          placeholder="Optional auth token"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          testID="settings-auth-token"
          accessibilityLabel="Auth token"
        />

        <View style={[styles.row, styles.sectionLabel]}>
          <Text style={[typography.body, { color: colors.text }]}>
            Dark Mode
          </Text>
          <Switch
            value={isDarkMode}
            onValueChange={setIsDarkMode}
            accessibilityLabel="Dark mode"
          />
        </View>

        <View style={[styles.row, styles.sectionLabel]}>
          <Text style={[typography.body, { color: colors.text }]}>
            Haptics & Sounds
          </Text>
          <Switch
            value={feedbackEnabled}
            onValueChange={setFeedbackEnabled}
            accessibilityLabel="Haptics and sounds"
          />
        </View>

        <Pressable
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleTestConnection}
          accessibilityRole="button"
          accessibilityLabel="Test connection"
          testID="settings-save"
        >
          <Text style={styles.buttonText}>Test Connection</Text>
        </Pressable>

        {testStatus ? (
          <Text
            style={[
              typography.bodySmall,
              styles.status,
              {
                color:
                  testStatus === "Connected" ? colors.success : colors.error,
              },
            ]}
          >
            {testStatus}
          </Text>
        ) : null}

        <Text
          style={[
            typography.label,
            { color: colors.textSecondary },
            styles.sectionLabel,
          ]}
        >
          Sync
        </Text>
        <Text
          style={[
            typography.bodySmall,
            styles.syncInfo,
            { color: colors.text },
          ]}
          testID="settings-pending-count"
        >
          {pendingMutationCount === 0
            ? "All changes synced"
            : `${String(pendingMutationCount)} ${
                pendingMutationCount === 1 ? "change" : "changes"
              } waiting to sync`}
        </Text>

        {deadLetters.length > 0 ? (
          <View testID="settings-dead-letters">
            <Text
              style={[
                typography.label,
                { color: colors.error },
                styles.sectionLabel,
              ]}
            >
              Failed Changes
            </Text>
            {deadLetters.map((entry) => (
              <View
                key={entry.command.id}
                style={[
                  styles.deadLetter,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                <Text style={[typography.body, { color: colors.text }]}>
                  {describeCommand(entry.command)}
                </Text>
                <Text
                  style={[
                    typography.bodySmall,
                    { color: colors.textSecondary },
                  ]}
                >
                  {entry.error.message}
                </Text>
                <View style={styles.deadLetterActions}>
                  <Pressable
                    style={[
                      styles.smallButton,
                      { backgroundColor: colors.primary },
                    ]}
                    onPress={() => {
                      void retryDeadLetter(entry.command.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Retry failed change"
                    testID={`dead-letter-retry-${entry.command.id}`}
                  >
                    <Text style={styles.buttonText}>Retry</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.smallButton,
                      { backgroundColor: colors.error },
                    ]}
                    onPress={() => {
                      void discardDeadLetter(entry.command.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Discard failed change"
                    testID={`dead-letter-discard-${entry.command.id}`}
                  >
                    <Text style={styles.buttonText}>Discard</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  sectionLabel: {
    marginTop: 20,
  },
  input: {
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  button: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  status: {
    textAlign: "center",
    marginTop: 12,
  },
  syncInfo: {
    marginTop: 8,
  },
  deadLetter: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    gap: 4,
  },
  deadLetterActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
});
