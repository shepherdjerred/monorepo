import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from "react-native";
import { useSettings } from "../hooks/useSettings";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

export function SettingsScreen() {
  const { daemonUrl, saveDaemonUrl, error } = useSettings();
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
        `Failed to connect: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  return (
    <ScrollView style={commonStyles.container}>
      <View style={styles.content}>
        <Text style={commonStyles.heading1}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Daemon URL</Text>
          <TextInput
            style={[commonStyles.input, styles.input]}
            value={url}
            onChangeText={setUrl}
            placeholder="http://localhost:3030"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        <TouchableOpacity
          style={[commonStyles.button, styles.button]}
          onPress={handleSave}
          disabled={isSaving || !url}
        >
          <Text style={commonStyles.buttonText}>
            {isSaving ? "Saving..." : "Save URL"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[commonStyles.button, styles.button, styles.secondaryButton]}
          onPress={handleTest}
          disabled={!url}
        >
          <Text style={commonStyles.buttonText}>Test Connection</Text>
        </TouchableOpacity>

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>About</Text>
          <Text style={styles.infoText}>Clauderon Mobile v0.1.0</Text>
          <Text style={styles.infoText}>
            Connect to your self-hosted Clauderon daemon
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
  },
  section: {
    marginTop: 24,
    marginBottom: 16,
  },
  label: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  input: {
    marginBottom: 8,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.error,
    marginTop: 4,
  },
  button: {
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: colors.textLight,
  },
  infoSection: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  infoTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  infoText: {
    fontSize: typography.fontSize.base,
    color: colors.textLight,
    marginBottom: 8,
  },
});
