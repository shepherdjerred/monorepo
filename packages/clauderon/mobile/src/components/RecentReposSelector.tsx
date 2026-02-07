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
import { useTheme } from "../contexts/ThemeContext";
import { typography } from "../styles/typography";
import { formatRelativeTime } from "../lib/utils";

type RecentReposSelectorProps = {
  visible: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
};

export function RecentReposSelector({ visible, onSelect, onClose }: RecentReposSelectorProps) {
  const { client } = useSessionContext();
  const { colors } = useTheme();
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
    const path = repo.subdirectory ? `${repo.repo_path}/${repo.subdirectory}` : repo.repo_path;
    onSelect(path);
  };

  const themedStyles = getThemedStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={themedStyles.sheet}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.textDark }]}>Recent Repositories</Text>
            <TouchableOpacity
              style={[
                styles.closeButton,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
              onPress={onClose}
            >
              <Text style={[styles.closeButtonText, { color: colors.textDark }]}>X</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textLight }]}>Loading...</Text>
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
              <TouchableOpacity
                style={[
                  styles.retryButton,
                  { borderColor: colors.border, backgroundColor: colors.primary },
                ]}
                onPress={() => void loadRepos()}
              >
                <Text style={[styles.retryButtonText, { color: colors.textWhite }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : repos.length === 0 ? (
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: colors.textLight }]}>
                No recent repositories
              </Text>
            </View>
          ) : (
            <FlatList
              data={repos}
              keyExtractor={(item) => `${item.repo_path}-${item.subdirectory || "root"}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.repoItem,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                  onPress={() => {
                    handleSelect(item);
                  }}
                >
                  <Text style={[styles.repoPath, { color: colors.textDark }]} numberOfLines={1}>
                    {item.subdirectory ? `${item.repo_path}/${item.subdirectory}` : item.repo_path}
                  </Text>
                  <Text style={[styles.repoTime, { color: colors.textLight }]}>
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

function getThemedStyles(colors: { surface: string; border: string }) {
  return StyleSheet.create({
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
  });
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 2,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  centered: {
    padding: 32,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: typography.fontSize.base,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 2,
  },
  retryButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  emptyText: {
    fontSize: typography.fontSize.base,
  },
  listContent: {
    padding: 8,
  },
  repoItem: {
    padding: 16,
    borderWidth: 2,
    marginBottom: 8,
  },
  repoPath: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.mono,
    marginBottom: 4,
  },
  repoTime: {
    fontSize: typography.fontSize.xs,
  },
});
