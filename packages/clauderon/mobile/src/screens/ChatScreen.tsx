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
} from "react-native";
import type { RootStackScreenProps } from "../types/navigation";
import { useConsole } from "../hooks/useConsole";
import { MessageParser } from "../lib/claudeParser";
import { MessageBubble } from "../components/MessageBubble";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

type ChatScreenProps = RootStackScreenProps<"Chat">;

export function ChatScreen({ route, navigation }: ChatScreenProps) {
  const { sessionId, sessionName } = route.params;
  const { client, isConnected } = useConsole(sessionId);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const parserRef = useRef(new MessageParser());
  const [messages, setMessages] = useState(() => parserRef.current.getMessages());
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    navigation.setOptions({ title: sessionName });
  }, [navigation, sessionName]);

  // Handle incoming terminal data
  useEffect(() => {
    if (!client) {
      return;
    }

    const unsubscribe = client.onData((data) => {
      parserRef.current.addOutput(data);
      setMessages([...parserRef.current.getMessages()]);
    });

    const unsubscribeError = client.onError((err) => {
      setError(err.message);
    });

    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [client]);

  const handleSubmit = () => {
    if (!input.trim() || !client || !isConnected) {
      return;
    }

    // Send input to console
    client.write(input + "\n");
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
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
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
          <View style={commonStyles.emptyState}>
            <Text style={commonStyles.emptyStateText}>
              No messages yet
            </Text>
            <Text style={styles.emptySubtext}>
              Start a conversation with the AI
            </Text>
          </View>
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
