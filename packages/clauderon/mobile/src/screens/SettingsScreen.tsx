import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import type { MainTabScreenProps } from "../types/navigation";
import { useSettings } from "../hooks/useSettings";
import { useTheme, type ThemeMode } from "../contexts/ThemeContext";
import { typography } from "../styles/typography";

type SettingsScreenProps = MainTabScreenProps<"Settings">;

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const { daemonUrl, saveDaemonUrl, error } = useSettings();
  const { mode, setMode, colors } = useTheme();
  const [url, setUrl] = useState(daemonUrl || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    const success = await saveDaemonUrl(url);
    setIsSaving(false);

    if (success) {
      Alert.alert("Success", "Daemon URL saved successfully");
    }
  };

  const handleTest = async () => {
    if (!url) {
      Alert.alert("Error", "Please enter a daemon URL");
      return;
    }

    try {
      const response = await fetch(`${url}/api/status`);
      if (response.ok) {
        Alert.alert("Success", "Successfully connected to daemon");
      } else {
        Alert.alert("Error", `Connection failed: ${response.statusText}`);
      }
    } catch (err) {
      Alert.alert(
        "Error",
        `Failed to connect: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  };

  const themedStyles = getThemedStyles(colors);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.heading, { color: colors.textDark }]}>Settings</Text>

        {/* Theme Section */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.textDark }]}>Theme</Text>
          <View style={styles.themeOptions}>
            {THEME_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.themeOption,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                  mode === option.value && { backgroundColor: colors.primary },
                ]}
                onPress={() => void setMode(option.value)}
              >
                <Text
                  style={[
                    styles.themeOptionText,
                    { color: colors.textDark },
                    mode === option.value && { color: colors.textWhite },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Daemon URL Section */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.textDark }]}>Daemon URL</Text>
          <TextInput
            style={[
              themedStyles.input,
              { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text },
            ]}
            value={url}
            onChangeText={setUrl}
            placeholder="http://localhost:3030"
            placeholderTextColor={colors.textLight}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
        </View>

        <TouchableOpacity
          style={[
            themedStyles.button,
            { borderColor: colors.border, backgroundColor: colors.primary },
          ]}
          onPress={() => void handleSave()}
          disabled={isSaving || !url}
        >
          <Text style={[styles.buttonText, { color: colors.textWhite }]}>
            {isSaving ? "Saving..." : "Save URL"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            themedStyles.button,
            { borderColor: colors.border, backgroundColor: colors.textLight },
          ]}
          onPress={() => void handleTest()}
          disabled={!url}
        >
          <Text style={[styles.buttonText, { color: colors.textWhite }]}>Test Connection</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            themedStyles.statusButton,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={() => {
            navigation.navigate("Status");
          }}
        >
          <Text style={[styles.statusButtonText, { color: colors.textDark }]}>System Status</Text>
          <Text style={[styles.statusButtonSubtext, { color: colors.textLight }]}>
            Credentials, usage, and proxies
          </Text>
        </TouchableOpacity>

        <View style={[styles.infoSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.infoTitle, { color: colors.textDark }]}>About</Text>
          <Text style={[styles.infoText, { color: colors.textLight }]}>
            Clauderon Mobile v0.1.0
          </Text>
          <Text style={[styles.infoText, { color: colors.textLight }]}>
            Connect to your self-hosted Clauderon daemon
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

// Dynamic styles based on theme colors
function getThemedStyles(colors: { border: string }) {
  return StyleSheet.create({
    input: {
      borderWidth: 2,
      padding: 12,
      fontSize: typography.fontSize.base,
      marginBottom: 8,
    },
    button: {
      borderWidth: 3,
      paddingVertical: 12,
      paddingHorizontal: 20,
      marginBottom: 12,
      ...Platform.select({
        ios: {
          shadowColor: colors.border,
          shadowOffset: { width: 3, height: 3 },
          shadowOpacity: 1,
          shadowRadius: 0,
        },
        android: {
          elevation: 3,
        },
      }),
    },
    statusButton: {
      marginTop: 16,
      padding: 16,
      borderWidth: 3,
      ...Platform.select({
        ios: {
          shadowColor: colors.border,
          shadowOffset: { width: 3, height: 3 },
          shadowOpacity: 1,
          shadowRadius: 0,
        },
        android: {
          elevation: 3,
        },
      }),
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  heading: {
    fontSize: typography.fontSize["3xl"],
    fontWeight: typography.fontWeight.extrabold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  section: {
    marginTop: 24,
    marginBottom: 16,
  },
  label: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  themeOptions: {
    flexDirection: "row",
    gap: 8,
  },
  themeOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    alignItems: "center",
  },
  themeOptionText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    marginTop: 4,
  },
  buttonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  statusButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  statusButtonSubtext: {
    fontSize: typography.fontSize.sm,
  },
  infoSection: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 2,
  },
  infoTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  infoText: {
    fontSize: typography.fontSize.base,
    marginBottom: 8,
  },
});
