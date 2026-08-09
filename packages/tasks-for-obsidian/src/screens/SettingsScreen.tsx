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
import { AppearancePicker } from "../components/settings/AppearancePicker";
import { useSettings } from "../hooks/use-settings";
import { useTaskContext } from "../state/TaskContext";
import { controlSize, radii, separator, spacing } from "../styles/tokens";
import { dynamicTypeRamps, typography } from "../styles/typography";

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
    appearance,
    feedbackEnabled,
    apiUrl,
    authToken,
    setApiUrl,
    setAuthToken,
    setAppearance,
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
        <Text
          style={[typography.label, { color: colors.textSecondary }]}
          dynamicTypeRamp={dynamicTypeRamps.label}
        >
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
          allowFontScaling
        />

        <Text
          style={[
            typography.label,
            { color: colors.textSecondary },
            styles.sectionLabel,
          ]}
          dynamicTypeRamp={dynamicTypeRamps.label}
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
          allowFontScaling
        />

        <Text
          style={[
            typography.label,
            { color: colors.textSecondary },
            styles.sectionLabel,
          ]}
          dynamicTypeRamp={dynamicTypeRamps.label}
        >
          Appearance
        </Text>
        <AppearancePicker
          appearance={appearance}
          colors={colors}
          onChange={setAppearance}
        />

        <View style={[styles.row, styles.sectionLabel]}>
          <Text
            style={[typography.body, { color: colors.text }]}
            dynamicTypeRamp={dynamicTypeRamps.body}
          >
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
          <Text
            style={[styles.buttonText, { color: colors.textInverse }]}
            dynamicTypeRamp={dynamicTypeRamps.subheading}
          >
            Test Connection
          </Text>
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
            dynamicTypeRamp={dynamicTypeRamps.bodySmall}
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
          dynamicTypeRamp={dynamicTypeRamps.label}
        >
          Sync
        </Text>
        <Text
          style={[
            typography.bodySmall,
            styles.syncInfo,
            { color: colors.text },
          ]}
          dynamicTypeRamp={dynamicTypeRamps.bodySmall}
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
              dynamicTypeRamp={dynamicTypeRamps.label}
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
                <Text
                  style={[typography.body, { color: colors.text }]}
                  dynamicTypeRamp={dynamicTypeRamps.body}
                >
                  {describeCommand(entry.command)}
                </Text>
                <Text
                  style={[
                    typography.bodySmall,
                    { color: colors.textSecondary },
                  ]}
                  dynamicTypeRamp={dynamicTypeRamps.bodySmall}
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
                    <Text
                      style={[styles.buttonText, { color: colors.textInverse }]}
                      dynamicTypeRamp={dynamicTypeRamps.subheading}
                    >
                      Retry
                    </Text>
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
                    <Text
                      style={[styles.buttonText, { color: colors.textInverse }]}
                      dynamicTypeRamp={dynamicTypeRamps.subheading}
                    >
                      Discard
                    </Text>
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
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  sectionLabel: {
    marginTop: spacing.xl,
  },
  input: {
    fontSize: 16,
    minHeight: controlSize.minimumHitTarget,
    padding: spacing.md,
    borderRadius: radii.medium,
    borderWidth: separator.hairline,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: controlSize.minimumHitTarget,
  },
  button: {
    minHeight: controlSize.minimumHitTarget,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.medium,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xxl,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  status: {
    textAlign: "center",
    marginTop: spacing.md,
  },
  syncInfo: {
    marginTop: spacing.sm,
  },
  deadLetter: {
    borderWidth: separator.hairline,
    borderRadius: radii.medium,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  deadLetterActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  smallButton: {
    minHeight: controlSize.minimumHitTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.medium,
    alignItems: "center",
    justifyContent: "center",
  },
});
