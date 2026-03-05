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
import { useSettings } from "../hooks/use-settings";
import { typography } from "../styles/typography";

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
});
