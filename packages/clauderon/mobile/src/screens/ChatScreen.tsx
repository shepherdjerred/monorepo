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
  Image,
  ScrollView,
  Alert,
} from "react-native";
import { launchImageLibrary, launchCamera } from "../lib/imagePicker";
import type { RootStackScreenProps } from "../types/navigation";
import { useConsole } from "../hooks/useConsole";
import { useSessionHistory } from "../hooks/useSessionHistory";
import type { Message } from "../lib/claudeParser";
import { MessageBubble } from "../components/MessageBubble";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";
import { useClauderonClient } from "../hooks/useClauderonClient";

type ChatScreenProps = RootStackScreenProps<"Chat">;

export function ChatScreen({ route, navigation }: ChatScreenProps) {
  const { sessionId, sessionName } = route.params;
  const { client, isConnected } = useConsole(sessionId);
  const { messages, isLoading, error: historyError, fileExists } = useSessionHistory(sessionId);
  const apiClient = useClauderonClient();
  const [input, setInput] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<{ uri: string; name: string }[]>([]);
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

  const handlePickImage = async () => {
    const result = await launchImageLibrary({
      mediaType: "photo",
      selectionLimit: 5,
      quality: 0.8,
    });

    if (result.errorMessage) {
      Alert.alert("Image Picker Not Available", result.errorMessage);
      return;
    }

    if (result.assets) {
      const newImages = result.assets
        .filter((asset): asset is typeof asset & { uri: string } => asset.uri !== undefined)
        .map((asset) => ({
          uri: asset.uri,
          name: asset.fileName ?? "image.jpg",
        }));
      setAttachedImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleTakePhoto = async () => {
    const result = await launchCamera({
      mediaType: "photo",
      quality: 0.8,
      saveToPhotos: false,
    });

    if (result.errorMessage) {
      Alert.alert("Camera Not Available", result.errorMessage);
      return;
    }

    const asset = result.assets?.[0];
    const uri = asset?.uri;
    if (uri) {
      setAttachedImages((prev) => [
        ...prev,
        {
          uri,
          name: asset.fileName ?? "photo.jpg",
        },
      ]);
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() || !client || !isConnected) {
      return;
    }

    // Upload images first if any
    if (attachedImages.length > 0 && apiClient) {
      for (const image of attachedImages) {
        try {
          await apiClient.uploadImage(sessionId, image.uri, image.name);
        } catch (error) {
          console.error("Failed to upload image:", error);
          // Continue even if upload fails
        }
      }
      setAttachedImages([]);
    }

    // Send input to console
    client.write(input + "\r");
    setInput("");
  };

  // On desktop platforms, don't use KeyboardAvoidingView
  const isDesktop = Platform.OS === "macos" || Platform.OS === "windows";
  const ContainerView = isDesktop ? View : KeyboardAvoidingView;
  const keyboardProps = isDesktop
    ? {}
    : {
        behavior: Platform.OS === "ios" ? ("padding" as const) : ("height" as const),
        keyboardVerticalOffset: Platform.OS === "ios" ? 90 : 0,
      };

  return (
    <ContainerView style={commonStyles.container} {...keyboardProps}>
      {/* Header with connection status */}
      <View style={styles.header}>
        <ConnectionStatus isConnected={isConnected} label="Console" />
      </View>

      {/* Error display */}
      {(wsError ?? historyError) && (
        <View style={styles.errorContainer}>
          {wsError && <Text style={styles.errorText}>WebSocket: {wsError}</Text>}
          {historyError && <Text style={styles.errorText}>History: {historyError}</Text>}
        </View>
      )}

      {/* Messages */}
      <FlatList<Message>
        ref={flatListRef}
        data={messages}
        keyExtractor={(item: Message) => item.id}
        renderItem={({ item }: { item: Message }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
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

      {/* Image previews */}
      {attachedImages.length > 0 && (
        <ScrollView
          horizontal
          style={styles.imagePreviewContainer}
          contentContainerStyle={styles.imagePreviewContent}
        >
          {attachedImages.map((img, index) => (
            <View key={index} style={styles.imagePreviewWrapper}>
              <Image source={{ uri: img.uri }} style={styles.imagePreview} />
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={() => {
                  setAttachedImages((imgs) => imgs.filter((_, i) => i !== index));
                }}
              >
                <Text style={styles.removeImageText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <TouchableOpacity
          style={[commonStyles.button, styles.imageButton]}
          onPress={() => void handlePickImage()}
          disabled={!isConnected}
        >
          <Text style={styles.imageButtonText}>📷</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[commonStyles.button, styles.imageButton]}
          onPress={() => void handleTakePhoto()}
          disabled={!isConnected}
        >
          <Text style={styles.imageButtonText}>📸</Text>
        </TouchableOpacity>
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
          onPress={() => void handleSubmit()}
          disabled={!isConnected || !input.trim()}
        >
          <Text style={commonStyles.buttonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </ContainerView>
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
  imagePreviewContainer: {
    maxHeight: 100,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  imagePreviewContent: {
    padding: 8,
    gap: 8,
  },
  imagePreviewWrapper: {
    position: "relative",
  },
  imagePreview: {
    width: 80,
    height: 80,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  removeImageButton: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.error,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  removeImageText: {
    color: colors.textWhite,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
  },
  inputContainer: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: 8,
  },
  imageButton: {
    alignSelf: "flex-end",
    paddingVertical: 12,
    paddingHorizontal: 12,
    minWidth: 48,
  },
  imageButtonText: {
    fontSize: 20,
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
