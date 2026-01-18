import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import type { CredentialStatus } from "../types/generated";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";

type CredentialRowProps = {
  credential: CredentialStatus;
  onSave: (serviceId: string, value: string) => Promise<void>;
};

export function CredentialRow({ credential, onSave }: CredentialRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const handleSave = useCallback(async () => {
    if (!value.trim()) return;

    setIsSaving(true);
    try {
      await onSave(credential.service_id, value.trim());
      setValue("");
      setIsEditing(false);
    } catch {
      // Error handling in parent
    } finally {
      setIsSaving(false);
    }
  }, [credential.service_id, value, onSave]);

  const handleCancel = () => {
    setValue("");
    setIsEditing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <View
            style={[
              styles.statusDot,
              credential.available ? styles.statusAvailable : styles.statusMissing,
            ]}
          />
          <Text style={styles.name}>{credential.name}</Text>
        </View>
        {credential.readonly && (
          <View style={styles.readonlyBadge}>
            <Text style={styles.readonlyText}>Readonly</Text>
          </View>
        )}
      </View>

      {credential.available && credential.masked_value && (
        <View style={styles.valueRow}>
          <Text style={styles.maskedValue}>
            {showValue ? credential.masked_value : "••••••••••••"}
          </Text>
          <TouchableOpacity
            style={styles.showButton}
            onPress={() => setShowValue(!showValue)}
          >
            <Text style={styles.showButtonText}>
              {showValue ? "Hide" : "Show"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {credential.source && (
        <Text style={styles.source}>Source: {credential.source}</Text>
      )}

      {!credential.readonly && (
        <>
          {isEditing ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder="Enter credential value"
                placeholderTextColor={colors.textLight}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleCancel}
                  disabled={isSaving}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    (!value.trim() || isSaving) && styles.buttonDisabled,
                  ]}
                  onPress={handleSave}
                  disabled={!value.trim() || isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color={colors.textWhite} />
                  ) : (
                    <Text style={styles.saveButtonText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setIsEditing(true)}
            >
              <Text style={styles.editButtonText}>
                {credential.available ? "Update" : "Add"}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
  },
  statusAvailable: {
    backgroundColor: colors.success,
  },
  statusMissing: {
    backgroundColor: colors.error,
  },
  name: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
  },
  readonlyBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: colors.textLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readonlyText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  maskedValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
  },
  showButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  showButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  source: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
    marginBottom: 8,
  },
  editRow: {
    marginTop: 8,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 10,
    fontSize: typography.fontSize.base,
    color: colors.text,
    marginBottom: 8,
  },
  editActions: {
    flexDirection: "row",
    gap: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  saveButton: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  editButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  editButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
});
