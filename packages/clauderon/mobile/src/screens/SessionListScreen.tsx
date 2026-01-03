import React from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import type { MainTabScreenProps } from "../types/navigation";
import { useSessionContext } from "../contexts/SessionContext";
import { SessionCard } from "../components/SessionCard";
import { colors } from "../styles/colors";
import { commonStyles } from "../styles/common";

type SessionListScreenProps = MainTabScreenProps<"Sessions">;

export function SessionListScreen({ navigation }: SessionListScreenProps) {
  const { sessions, isLoading, refreshSessions } = useSessionContext();

  const sessionArray = Array.from(sessions.values());

  const handleSessionPress = (sessionId: string, sessionName: string) => {
    navigation.navigate("Chat", { sessionId, sessionName });
  };

  if (isLoading && sessionArray.length === 0) {
    return (
      <View style={commonStyles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading sessions...</Text>
      </View>
    );
  }

  if (sessionArray.length === 0) {
    return (
      <View style={commonStyles.emptyState}>
        <Text style={commonStyles.emptyStateText}>No sessions found</Text>
        <Text style={styles.emptySubtext}>
          Configure the daemon URL in Settings to get started
        </Text>
      </View>
    );
  }

  return (
    <View style={commonStyles.container}>
      <FlatList
        data={sessionArray}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SessionCard
            session={item}
            onPress={() => handleSessionPress(item.id, item.name)}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refreshSessions}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: 16,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textLight,
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textLight,
    textAlign: "center",
  },
});
