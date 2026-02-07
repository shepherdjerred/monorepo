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
import { useTheme } from "../contexts/ThemeContext";
import { RecentReposSelector } from "../components/RecentReposSelector";
import { typography } from "../styles/typography";

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
  const { colors } = useTheme();

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

  const themedStyles = getThemedStyles(colors);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Repository Path */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textDark }]}>Repository Path</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[themedStyles.input, styles.inputFlex, { color: colors.text }]}
              value={repoPath}
              onChangeText={setRepoPath}
              placeholder="/path/to/repository"
              placeholderTextColor={colors.textLight}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={themedStyles.browseButton}
              onPress={() => {
                setShowRecentRepos(true);
              }}
            >
              <Text style={[styles.browseButtonText, { color: colors.textDark }]}>Recent</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Initial Prompt */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textDark }]}>Initial Prompt</Text>
          <TextInput
            style={[themedStyles.input, styles.multilineInput, { color: colors.text }]}
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
          <Text style={[styles.label, { color: colors.textDark }]}>Backend</Text>
          <View style={styles.optionsRow}>
            {BACKENDS.map((b) => (
              <TouchableOpacity
                key={b.value}
                style={[
                  themedStyles.optionButton,
                  backend === b.value && { backgroundColor: colors.primary },
                ]}
                onPress={() => {
                  setBackend(b.value);
                }}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    { color: colors.textDark },
                    backend === b.value && { color: colors.textWhite },
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
          <Text style={[styles.label, { color: colors.textDark }]}>Agent</Text>
          <View style={styles.optionsRow}>
            {AGENTS.map((a) => (
              <TouchableOpacity
                key={a.value}
                style={[
                  themedStyles.optionButton,
                  agent === a.value && { backgroundColor: colors.primary },
                ]}
                onPress={() => {
                  setAgent(a.value);
                }}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    { color: colors.textDark },
                    agent === a.value && { color: colors.textWhite },
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
          <Text style={[styles.label, { color: colors.textDark }]}>Access Mode</Text>
          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={[
                themedStyles.optionButton,
                accessMode === AccessMode.ReadOnly && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                setAccessMode(AccessMode.ReadOnly);
              }}
            >
              <Text
                style={[
                  styles.optionButtonText,
                  { color: colors.textDark },
                  accessMode === AccessMode.ReadOnly && { color: colors.textWhite },
                ]}
              >
                Read Only
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                themedStyles.optionButton,
                accessMode === AccessMode.ReadWrite && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                setAccessMode(AccessMode.ReadWrite);
              }}
            >
              <Text
                style={[
                  styles.optionButtonText,
                  { color: colors.textDark },
                  accessMode === AccessMode.ReadWrite && { color: colors.textWhite },
                ]}
              >
                Read Write
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Toggles */}
        <View style={styles.togglesSection}>
          <View style={[styles.toggleRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>Plan Mode</Text>
            <Switch
              value={planMode}
              onValueChange={setPlanMode}
              trackColor={{ false: colors.borderLight, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
          <View style={[styles.toggleRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>Skip Safety Checks</Text>
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
      <View style={themedStyles.actionBar}>
        <TouchableOpacity
          style={[themedStyles.actionButton, { backgroundColor: colors.surface }]}
          onPress={() => {
            navigation.goBack();
          }}
          disabled={isSubmitting}
        >
          <Text style={[styles.buttonText, { color: colors.textDark }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            themedStyles.actionButton,
            { backgroundColor: colors.primary },
            isSubmitting && styles.buttonDisabled,
          ]}
          onPress={() => void handleSubmit()}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.textWhite} size="small" />
          ) : (
            <Text style={[styles.buttonText, { color: colors.textWhite }]}>Create Session</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Recent Repos Selector */}
      <RecentReposSelector
        visible={showRecentRepos}
        onSelect={handleRepoSelect}
        onClose={() => {
          setShowRecentRepos(false);
        }}
      />
    </View>
  );
}

function getThemedStyles(colors: { surface: string; border: string; borderLight: string }) {
  return StyleSheet.create({
    input: {
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
      padding: 12,
      fontSize: typography.fontSize.base,
    },
    browseButton: {
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
      paddingHorizontal: 16,
      justifyContent: "center" as const,
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
    optionButton: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.surface,
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
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 8,
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
  browseButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
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
  },
  toggleLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
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
