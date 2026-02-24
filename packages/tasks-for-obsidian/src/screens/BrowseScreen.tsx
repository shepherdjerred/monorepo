import React, { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { projectName } from "../domain/types";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { useTasks } from "../hooks/useTasks";
import { useSettings } from "../hooks/useSettings";
import { typography } from "../styles/typography";
import { EmptyState } from "../components/common/EmptyState";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Browse">,
  NativeStackScreenProps<RootStackParamList>
>;

type Segment = "projects" | "labels";

export function BrowseScreen({ navigation }: Props) {
  const { colors } = useSettings();
  const { projectNames, tagNames } = useTasks();
  const [segment, setSegment] = useState<Segment>("projects");

  const items = segment === "projects" ? projectNames : tagNames;

  const handlePress = useCallback(
    (name: string) => {
      if (segment === "projects") {
        navigation.navigate("ProjectDetail", { projectName: projectName(name) });
      }
    },
    [navigation, segment],
  );

  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <Pressable
        style={[styles.item, { borderBottomColor: colors.borderLight }]}
        onPress={() => handlePress(item)}
      >
        <Text style={[typography.body, { color: colors.text }]}>{item}</Text>
      </Pressable>
    ),
    [colors, handlePress],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.segmentContainer, { borderBottomColor: colors.border }]}>
        <Pressable
          style={[
            styles.segment,
            segment === "projects" && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
          ]}
          onPress={() => setSegment("projects")}
        >
          <Text
            style={[
              typography.subheading,
              { color: segment === "projects" ? colors.primary : colors.textSecondary },
            ]}
          >
            Projects
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.segment,
            segment === "labels" && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
          ]}
          onPress={() => setSegment("labels")}
        >
          <Text
            style={[
              typography.subheading,
              { color: segment === "labels" ? colors.primary : colors.textSecondary },
            ]}
          >
            Labels
          </Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <EmptyState
          title={segment === "projects" ? "No projects" : "No labels"}
          subtitle={segment === "projects" ? "Create tasks with a project to see them here" : "Add tags to tasks to see them here"}
        />
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
