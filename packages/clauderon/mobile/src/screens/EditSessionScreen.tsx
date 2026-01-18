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
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

type EditSessionScreenProps = RootStackScreenProps<"EditSession">;

export function EditSessionScreen({
  navigation,
  route,
}: EditSessionScreenProps) {
  const { session } = route.params;
  const { client } = useSessionContext();

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

  return (
    <View style={commonStyles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Session Info */}
        <View style={styles.infoSection}>
          <Text style={styles.infoLabel}>Session Name</Text>
          <Text style={styles.infoValue}>{session.name}</Text>
        </View>

        {/* Title */}
        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Session title"
            placeholderTextColor={colors.textLight}
            editable={!isLoading}
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
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
            styles.regenerateButton,
            isLoading && styles.buttonDisabled,
          ]}
          onPress={handleRegenerate}
          disabled={isLoading}
        >
          {isRegenerating ? (
            <ActivityIndicator size="small" color={colors.textDark} />
          ) : (
            <Text style={styles.regenerateButtonText}>
              Regenerate with AI
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.actionButton, styles.cancelButton]}
          onPress={() => navigation.goBack()}
          disabled={isLoading}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.saveButton,
            isLoading && styles.buttonDisabled,
          ]}
          onPress={handleSave}
          disabled={isLoading}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.textWhite} size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
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
    borderBottomColor: colors.borderLight,
  },
  infoLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textLight,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  infoValue: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.mono,
    color: colors.textDark,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 12,
    fontSize: typography.fontSize.base,
    color: colors.text,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  regenerateButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
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
  regenerateButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  actionBar: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 3,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
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
  cancelButton: {
    backgroundColor: colors.surface,
  },
  saveButton: {
    backgroundColor: colors.primary,
  },
  cancelButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  saveButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
