import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import type { RecentRepoDto } from "../types/generated";
import { useSessionContext } from "../contexts/SessionContext";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { formatRelativeTime } from "../lib/utils";

type RecentReposSelectorProps = {
  visible: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
};

export function RecentReposSelector({
  visible,
  onSelect,
  onClose,
}: RecentReposSelectorProps) {
  const { client } = useSessionContext();
  const [repos, setRepos] = useState<RecentRepoDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRepos = useCallback(async () => {
    if (!client) return;

    setIsLoading(true);
    setError(null);
    try {
      const recentRepos = await client.getRecentRepos();
      setRepos(recentRepos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repositories");
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (visible) {
      void loadRepos();
    }
  }, [visible, loadRepos]);

  const handleSelect = (repo: RecentRepoDto) => {
    const path = repo.subdirectory
      ? `${repo.repo_path}/${repo.subdirectory}`
      : repo.repo_path;
    onSelect(path);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Recent Repositories</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>X</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={loadRepos}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : repos.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No recent repositories</Text>
            </View>
          ) : (
            <FlatList
              data={repos}
              keyExtractor={(item) =>
                `${item.repo_path}-${item.subdirectory || "root"}`
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.repoItem}
                  onPress={() => handleSelect(item)}
                >
                  <Text style={styles.repoPath} numberOfLines={1}>
                    {item.subdirectory
                      ? `${item.repo_path}/${item.subdirectory}`
                      : item.repo_path}
                  </Text>
                  <Text style={styles.repoTime}>
                    {formatRelativeTime(new Date(item.last_used))}
                  </Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderColor: colors.border,
    maxHeight: "70%",
    ...Platform.select({
      ios: {
        shadowColor: colors.border,
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 1,
        shadowRadius: 0,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
  },
  centered: {
    padding: 32,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: typography.fontSize.base,
    color: colors.textLight,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    color: colors.error,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.primary,
  },
  retryButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  emptyText: {
    fontSize: typography.fontSize.base,
    color: colors.textLight,
  },
  listContent: {
    padding: 8,
  },
  repoItem: {
    padding: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: 8,
  },
  repoPath: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.mono,
    color: colors.textDark,
    marginBottom: 4,
  },
  repoTime: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
  },
});
