import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import type { RootStackScreenProps } from "../types/navigation";
import { useConsole } from "../hooks/useConsole";
import { useSessionHistory } from "../hooks/useSessionHistory";
import { MessageBubble } from "../components/MessageBubble";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

type ChatScreenProps = RootStackScreenProps<"Chat">;

export function ChatScreen({ route, navigation }: ChatScreenProps) {
  const { sessionId, sessionName } = route.params;
  const { client, isConnected } = useConsole(sessionId);
  const { messages, isLoading, error: historyError, fileExists } = useSessionHistory(sessionId);
  const [input, setInput] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    navigation.setOptions({ title: sessionName });
  }, [navigation, sessionName]);

  // Handle WebSocket errors
  useEffect(() => {
    if (!client) {
      return;
    }

    const unsubscribeError = client.onError((err) => {
      setWsError(err.message);
    });

    return () => {
      unsubscribeError();
    };
  }, [client]);

  const handleSubmit = () => {
    if (!input.trim() || !client || !isConnected) {
      return;
    }

    // Send input to console
    client.write(input + "\r");
    setInput("");
  };

  return (
    <KeyboardAvoidingView
      style={commonStyles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* Header with connection status */}
      <View style={styles.header}>
        <ConnectionStatus isConnected={isConnected} label="Console" />
      </View>

      {/* Error display */}
      {(wsError || historyError) && (
        <View style={styles.errorContainer}>
          {wsError && <Text style={styles.errorText}>WebSocket: {wsError}</Text>}
          {historyError && <Text style={styles.errorText}>History: {historyError}</Text>}
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: true })
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={commonStyles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.emptySubtext}>Loading history...</Text>
            </View>
          ) : (
            <View style={commonStyles.emptyState}>
              <Text style={commonStyles.emptyStateText}>
                {fileExists ? "No messages yet" : "No history file"}
              </Text>
              <Text style={styles.emptySubtext}>
                {fileExists
                  ? "Start a conversation with the AI"
                  : "Start a conversation to create history"}
              </Text>
            </View>
          )
        }
      />

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={[commonStyles.input, styles.input]}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message or command..."
          placeholderTextColor={colors.textLight}
          editable={isConnected}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[
            commonStyles.button,
            styles.sendButton,
            (!isConnected || !input.trim()) && styles.sendButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!isConnected || !input.trim()}
        >
          <Text style={commonStyles.buttonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  errorContainer: {
    padding: 12,
    backgroundColor: colors.error,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
  },
  messagesContent: {
    flexGrow: 1,
    paddingVertical: 8,
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: typography.fontSize.sm,
    color: colors.textLight,
    textAlign: "center",
  },
  inputContainer: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: 8,
  },
  input: {
    flex: 1,
    maxHeight: 100,
  },
  sendButton: {
    alignSelf: "flex-end",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
