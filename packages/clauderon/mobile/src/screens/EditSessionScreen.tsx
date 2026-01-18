import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { RootStackScreenProps } from "../types/navigation";
import { useSessionContext } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { typography } from "../styles/typography";

type EditSessionScreenProps = RootStackScreenProps<"EditSession">;

export function EditSessionScreen({
  navigation,
  route,
}: EditSessionScreenProps) {
  const { session } = route.params;
  const { client } = useSessionContext();
  const { colors } = useTheme();

  const [title, setTitle] = useState(session.title || session.name);
  const [description, setDescription] = useState(session.description || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleSave = useCallback(async () => {
    if (!client) return;

    setIsSaving(true);
    try {
      await client.updateSessionMetadata(session.id, title.trim(), description.trim());
      navigation.goBack();
    } catch {
      Alert.alert("Error", "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }, [client, session.id, title, description, navigation]);

  const handleRegenerate = useCallback(async () => {
    if (!client) return;

    setIsRegenerating(true);
    try {
      const updatedSession = await client.regenerateMetadata(session.id);
      setTitle(updatedSession.title || updatedSession.name);
      setDescription(updatedSession.description || "");
    } catch {
      Alert.alert("Error", "Failed to regenerate metadata");
    } finally {
      setIsRegenerating(false);
    }
  }, [client, session.id]);

  const isLoading = isSaving || isRegenerating;
  const themedStyles = getThemedStyles(colors);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Session Info */}
        <View style={[styles.infoSection, { borderBottomColor: colors.borderLight }]}>
          <Text style={[styles.infoLabel, { color: colors.textLight }]}>Session Name</Text>
          <Text style={[styles.infoValue, { color: colors.textDark }]}>{session.name}</Text>
        </View>

        {/* Title */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textDark }]}>Title</Text>
          <TextInput
            style={[themedStyles.input, { color: colors.text }]}
            value={title}
            onChangeText={setTitle}
            placeholder="Session title"
            placeholderTextColor={colors.textLight}
            editable={!isLoading}
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textDark }]}>Description</Text>
          <TextInput
            style={[themedStyles.input, styles.multilineInput, { color: colors.text }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Session description"
            placeholderTextColor={colors.textLight}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            editable={!isLoading}
          />
        </View>

        {/* Regenerate Button */}
        <TouchableOpacity
          style={[
            themedStyles.regenerateButton,
            isLoading && styles.buttonDisabled,
          ]}
          onPress={handleRegenerate}
          disabled={isLoading}
        >
          {isRegenerating ? (
            <ActivityIndicator size="small" color={colors.textDark} />
          ) : (
            <Text style={[styles.regenerateButtonText, { color: colors.textDark }]}>
              Regenerate with AI
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Action Buttons */}
      <View style={themedStyles.actionBar}>
        <TouchableOpacity
          style={[themedStyles.actionButton, { backgroundColor: colors.surface }]}
          onPress={() => navigation.goBack()}
          disabled={isLoading}
        >
          <Text style={[styles.buttonText, { color: colors.textDark }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            themedStyles.actionButton,
            { backgroundColor: colors.primary },
            isLoading && styles.buttonDisabled,
          ]}
          onPress={handleSave}
          disabled={isLoading}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.textWhite} size="small" />
          ) : (
            <Text style={[styles.buttonText, { color: colors.textWhite }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function getThemedStyles(colors: { surface: string; border: string }) {
  return StyleSheet.create({
    input: {
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
      padding: 12,
      fontSize: typography.fontSize.base,
    },
    regenerateButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center" as const,
      ...Platform.select({
        ios: {
          shadowColor: colors.border,
          shadowOffset: { width: 2, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 0,
        },
        android: {
          elevation: 2,
        },
      }),
    },
    actionBar: {
      flexDirection: "row" as const,
      gap: 12,
      padding: 16,
      borderTopWidth: 3,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    actionButton: {
      flex: 1,
      paddingVertical: 14,
      alignItems: "center" as const,
      borderWidth: 3,
      borderColor: colors.border,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  infoSection: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
  },
  infoLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  infoValue: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.mono,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  regenerateButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  buttonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
