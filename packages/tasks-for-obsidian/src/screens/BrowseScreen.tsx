import React, { useState, useCallback, useMemo } from "react";
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { contextName, projectName, tagName } from "../domain/types";
import { DEFAULT_SAVED_VIEWS } from "../domain/saved-views";
import { applyFilter } from "../domain/filters";
import { isActiveStatus } from "../domain/status";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { useTasks } from "../hooks/use-tasks";
import { useSettings } from "../hooks/use-settings";
import { typography } from "../styles/typography";
import { EmptyState } from "../components/common/EmptyState";
import { SavedViewCard } from "../components/common/SavedViewCard";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Browse">,
  NativeStackScreenProps<RootStackParamList>
>;

type Segment = "projects" | "labels" | "contexts";

export function BrowseScreen({ navigation }: Props) {
  const { colors } = useSettings();
  const { taskList, projectNames, tagNames, contextNames } = useTasks();
  const [segment, setSegment] = useState<Segment>("projects");

  const activeTasks = useMemo(
    () => taskList.filter((t) => isActiveStatus(t.status)),
    [taskList],
  );

  const savedViewCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const view of DEFAULT_SAVED_VIEWS) {
      counts.set(view.id, applyFilter(activeTasks, view.filter).length);
    }
    return counts;
  }, [activeTasks]);

  const items = segment === "projects"
    ? projectNames
    : segment === "labels"
      ? tagNames
      : contextNames;

  const handlePress = useCallback(
    (name: string) => {
      if (segment === "projects") {
        navigation.navigate("ProjectDetail", { projectName: projectName(name) });
      } else if (segment === "labels") {
        navigation.navigate("TagDetail", { tagName: tagName(name) });
      } else {
        navigation.navigate("ContextDetail", { contextName: contextName(name) });
      }
    },
    [navigation, segment],
  );

  const emptyState = segment === "projects"
    ? { title: "No projects", subtitle: "Create tasks with a project to see them here" }
    : segment === "labels"
      ? { title: "No labels", subtitle: "Add tags to tasks to see them here" }
      : { title: "No contexts", subtitle: "Add contexts to tasks to see them here" };

  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <Pressable
        style={[styles.item, { borderBottomColor: colors.borderLight }]}
        onPress={() => { handlePress(item); }}
      >
        <Text style={[typography.body, { color: colors.text }]}>
          {segment === "labels" ? `#${item}` : segment === "contexts" ? `@${item}` : item}
        </Text>
      </Pressable>
    ),
    [colors, handlePress, segment],
  );

  const renderSegmentTab = useCallback(
    (key: Segment, label: string) => (
      <Pressable
        key={key}
        style={[
          styles.segment,
          segment === key && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
        ]}
        onPress={() => { setSegment(key); }}
      >
        <Text
          style={[
            typography.subheading,
            { color: segment === key ? colors.primary : colors.textSecondary },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    ),
    [colors, segment],
  );

  return (
    <View style={styles.container}>
      <ScrollView style={styles.savedViewsRow} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedViewsContent}>
        {DEFAULT_SAVED_VIEWS.map((view) => (
          <View key={view.id} style={styles.savedViewCardWrapper}>
            <SavedViewCard
              name={view.name}
              icon={view.icon}
              count={savedViewCounts.get(view.id) ?? 0}
              color={view.color}
              onPress={() => { navigation.navigate("SavedView", { viewId: view.id }); }}
            />
          </View>
        ))}
      </ScrollView>
      <View style={[styles.segmentContainer, { borderBottomColor: colors.border }]}>
        {renderSegmentTab("projects", "Projects")}
        {renderSegmentTab("labels", "Labels")}
        {renderSegmentTab("contexts", "Contexts")}
      </View>
      {items.length === 0 ? (
        <EmptyState title={emptyState.title} subtitle={emptyState.subtitle} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  savedViewsRow: {
    flexGrow: 0,
  },
  savedViewsContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  savedViewCardWrapper: {
    width: 140,
  },
  segmentContainer: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
