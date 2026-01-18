import React, { useState, useMemo, useCallback, useLayoutEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import type { MainTabScreenProps } from "../types/navigation";
import { useSessionContext } from "../contexts/SessionContext";
import { SessionCard } from "../components/SessionCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FilterTabs, type FilterStatus } from "../components/FilterTabs";
import type { Session } from "../types/generated";
import { SessionStatus } from "../types/generated";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

type SessionListScreenProps = MainTabScreenProps<"Sessions">;

export function SessionListScreen({ navigation }: SessionListScreenProps) {
  const {
    sessions,
    isLoading,
    refreshSessions,
    deleteSession,
    archiveSession,
    unarchiveSession,
    refreshSession,
  } = useSessionContext();

  const [filter, setFilter] = useState<FilterStatus>("all");
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Session | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [refreshTarget, setRefreshTarget] = useState<Session | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Add header button for creating sessions
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => navigation.navigate("CreateSession")}
        >
          <Text style={styles.headerButtonText}>+ New</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const handleEditSession = useCallback(
    (session: Session) => {
      navigation.navigate("EditSession", { session });
    },
    [navigation]
  );

  const filteredSessions = useMemo(() => {
    const sessionArray = Array.from(sessions.values());
    switch (filter) {
      case "running":
        return sessionArray.filter((s) => s.status === SessionStatus.Running);
      case "idle":
        return sessionArray.filter((s) => s.status === SessionStatus.Idle);
      case "completed":
        return sessionArray.filter((s) => s.status === SessionStatus.Completed);
      case "archived":
        return sessionArray.filter((s) => s.status === SessionStatus.Archived);
      default:
        return sessionArray.filter((s) => s.status !== SessionStatus.Archived);
    }
  }, [sessions, filter]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteSession(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // Error is handled by context
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, deleteSession]);

  const handleArchiveConfirm = useCallback(async () => {
    if (!archiveTarget) return;
    setIsArchiving(true);
    try {
      if (archiveTarget.status === SessionStatus.Archived) {
        await unarchiveSession(archiveTarget.id);
      } else {
        await archiveSession(archiveTarget.id);
      }
      setArchiveTarget(null);
    } catch {
      // Error is handled by context
    } finally {
      setIsArchiving(false);
    }
  }, [archiveTarget, archiveSession, unarchiveSession]);

  const handleRefreshConfirm = useCallback(async () => {
    if (!refreshTarget) return;
    setIsRefreshing(true);
    try {
      await refreshSession(refreshTarget.id);
      setRefreshTarget(null);
    } catch {
      // Error is handled by context
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshTarget, refreshSession]);

  const handleSessionPress = (sessionId: string, sessionName: string) => {
    navigation.navigate("Chat", { sessionId, sessionName });
  };

  if (isLoading && filteredSessions.length === 0 && sessions.size === 0) {
    return (
      <View style={commonStyles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading sessions...</Text>
      </View>
    );
  }

  return (
    <View style={commonStyles.container}>
      <FilterTabs value={filter} onChange={setFilter} />

      {filteredSessions.length === 0 ? (
        <View style={commonStyles.emptyState}>
          <Text style={commonStyles.emptyStateText}>
            {sessions.size === 0
              ? "No sessions found"
              : `No ${filter} sessions`}
          </Text>
          {sessions.size === 0 && (
            <Text style={styles.emptySubtext}>
              Configure the daemon URL in Settings to get started
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredSessions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              onPress={() => handleSessionPress(item.id, item.name)}
              onEdit={() => handleEditSession(item)}
              onArchive={() => setArchiveTarget(item)}
              onUnarchive={() => setArchiveTarget(item)}
              onDelete={() => setDeleteTarget(item)}
              onRefresh={() => setRefreshTarget(item)}
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
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete Session"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        loading={isDeleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Archive confirmation dialog */}
      <ConfirmDialog
        visible={archiveTarget !== null}
        title={
          archiveTarget?.status === SessionStatus.Archived
            ? "Unarchive Session"
            : "Archive Session"
        }
        description={
          archiveTarget?.status === SessionStatus.Archived
            ? `Are you sure you want to unarchive "${archiveTarget?.name}"?`
            : `Are you sure you want to archive "${archiveTarget?.name}"?`
        }
        confirmLabel={
          archiveTarget?.status === SessionStatus.Archived
            ? "Unarchive"
            : "Archive"
        }
        cancelLabel="Cancel"
        loading={isArchiving}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* Refresh confirmation dialog */}
      <ConfirmDialog
        visible={refreshTarget !== null}
        title="Refresh Session"
        description={`This will pull the latest container image and recreate the container for "${refreshTarget?.name}". The session history will be preserved.`}
        confirmLabel="Refresh"
        cancelLabel="Cancel"
        loading={isRefreshing}
        onConfirm={handleRefreshConfirm}
        onCancel={() => setRefreshTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    borderWidth: 2,
    borderColor: colors.textWhite,
  },
  headerButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
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
