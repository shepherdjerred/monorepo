import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { RootStackScreenProps } from "../types/navigation";
import type { CreateSessionRequest } from "../types/generated";
import { BackendType, AgentType, AccessMode } from "../types/generated";
import { useSessionContext } from "../contexts/SessionContext";
import { RecentReposSelector } from "../components/RecentReposSelector";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

type CreateSessionScreenProps = RootStackScreenProps<"CreateSession">;

const BACKENDS: { value: BackendType; label: string }[] = [
  { value: BackendType.Docker, label: "Docker" },
  { value: BackendType.Zellij, label: "Zellij" },
  { value: BackendType.Kubernetes, label: "Kubernetes" },
  { value: BackendType.AppleContainer, label: "Apple Container" },
];

const AGENTS: { value: AgentType; label: string }[] = [
  { value: AgentType.ClaudeCode, label: "Claude Code" },
  { value: AgentType.Codex, label: "Codex" },
  { value: AgentType.Gemini, label: "Gemini" },
];

export function CreateSessionScreen({ navigation }: CreateSessionScreenProps) {
  const { createSession } = useSessionContext();

  const [repoPath, setRepoPath] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [backend, setBackend] = useState<BackendType>(BackendType.Docker);
  const [agent, setAgent] = useState<AgentType>(AgentType.ClaudeCode);
  const [accessMode, setAccessMode] = useState<AccessMode>(AccessMode.ReadWrite);
  const [planMode, setPlanMode] = useState(true);
  const [skipChecks, setSkipChecks] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRecentRepos, setShowRecentRepos] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!repoPath.trim()) {
      Alert.alert("Error", "Repository path is required");
      return;
    }
    if (!initialPrompt.trim()) {
      Alert.alert("Error", "Initial prompt is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const request: CreateSessionRequest = {
        repo_path: repoPath.trim(),
        initial_prompt: initialPrompt.trim(),
        backend,
        agent,
        access_mode: accessMode,
        plan_mode: planMode,
        dangerous_skip_checks: skipChecks,
      };

      const sessionId = await createSession(request);
      if (sessionId) {
        navigation.goBack();
      }
    } catch {
      Alert.alert("Error", "Failed to create session");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    repoPath,
    initialPrompt,
    backend,
    agent,
    accessMode,
    planMode,
    skipChecks,
    createSession,
    navigation,
  ]);

  const handleRepoSelect = useCallback((path: string) => {
    setRepoPath(path);
    setShowRecentRepos(false);
  }, []);

  return (
    <View style={commonStyles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Repository Path */}
        <View style={styles.field}>
          <Text style={styles.label}>Repository Path</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, styles.inputFlex]}
              value={repoPath}
              onChangeText={setRepoPath}
              placeholder="/path/to/repository"
              placeholderTextColor={colors.textLight}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.browseButton}
              onPress={() => setShowRecentRepos(true)}
            >
              <Text style={styles.browseButtonText}>Recent</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Initial Prompt */}
        <View style={styles.field}>
          <Text style={styles.label}>Initial Prompt</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={initialPrompt}
            onChangeText={setInitialPrompt}
            placeholder="What should the AI agent work on?"
            placeholderTextColor={colors.textLight}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Backend Selection */}
        <View style={styles.field}>
          <Text style={styles.label}>Backend</Text>
          <View style={styles.optionsRow}>
            {BACKENDS.map((b) => (
              <TouchableOpacity
                key={b.value}
                style={[
                  styles.optionButton,
                  backend === b.value && styles.optionButtonActive,
                ]}
                onPress={() => setBackend(b.value)}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    backend === b.value && styles.optionButtonTextActive,
                  ]}
                >
                  {b.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Agent Selection */}
        <View style={styles.field}>
          <Text style={styles.label}>Agent</Text>
          <View style={styles.optionsRow}>
            {AGENTS.map((a) => (
              <TouchableOpacity
                key={a.value}
                style={[
                  styles.optionButton,
                  agent === a.value && styles.optionButtonActive,
                ]}
                onPress={() => setAgent(a.value)}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    agent === a.value && styles.optionButtonTextActive,
                  ]}
                >
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Access Mode */}
        <View style={styles.field}>
          <Text style={styles.label}>Access Mode</Text>
          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={[
                styles.optionButton,
                accessMode === AccessMode.ReadOnly && styles.optionButtonActive,
              ]}
              onPress={() => setAccessMode(AccessMode.ReadOnly)}
            >
              <Text
                style={[
                  styles.optionButtonText,
                  accessMode === AccessMode.ReadOnly &&
                    styles.optionButtonTextActive,
                ]}
              >
                Read Only
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.optionButton,
                accessMode === AccessMode.ReadWrite && styles.optionButtonActive,
              ]}
              onPress={() => setAccessMode(AccessMode.ReadWrite)}
            >
              <Text
                style={[
                  styles.optionButtonText,
                  accessMode === AccessMode.ReadWrite &&
                    styles.optionButtonTextActive,
                ]}
              >
                Read Write
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Toggles */}
        <View style={styles.togglesSection}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Plan Mode</Text>
            <Switch
              value={planMode}
              onValueChange={setPlanMode}
              trackColor={{ false: colors.borderLight, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Skip Safety Checks</Text>
            <Switch
              value={skipChecks}
              onValueChange={setSkipChecks}
              trackColor={{ false: colors.borderLight, true: colors.warning }}
              thumbColor={colors.surface}
            />
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.actionButton, styles.cancelButton]}
          onPress={() => navigation.goBack()}
          disabled={isSubmitting}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.submitButton,
            isSubmitting && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.textWhite} size="small" />
          ) : (
            <Text style={styles.submitButtonText}>Create Session</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Recent Repos Selector */}
      <RecentReposSelector
        visible={showRecentRepos}
        onSelect={handleRepoSelect}
        onClose={() => setShowRecentRepos(false)}
      />
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
  inputRow: {
    flexDirection: "row",
    gap: 8,
  },
  inputFlex: {
    flex: 1,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  browseButton: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: 16,
    justifyContent: "center",
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
  browseButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionButtonActive: {
    backgroundColor: colors.primary,
  },
  optionButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  optionButtonTextActive: {
    color: colors.textWhite,
  },
  togglesSection: {
    marginTop: 8,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  toggleLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
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
  submitButton: {
    backgroundColor: colors.primary,
  },
  cancelButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  submitButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
