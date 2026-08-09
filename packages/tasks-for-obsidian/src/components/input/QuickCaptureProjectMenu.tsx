import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { MenuView, type MenuAction } from "@react-native-menu/menu";

import {
  canonicalProjectKey,
  deriveProjectOptions,
  projectOptionLabel,
  type ProjectOption,
} from "../../domain/project-options";
import { useSettings } from "../../hooks/use-settings";
import { feedbackSelection } from "../../lib/feedback";
import { typography } from "../../styles/typography";
import { AppIcon } from "../common/AppIcon";

type Props = {
  readonly selectedProject: string | undefined;
  readonly projectOptions: readonly ProjectOption[];
  readonly onChange: (project: string | undefined) => void;
};

function actionImage(image: string): Pick<MenuAction, "image"> {
  return Platform.OS === "ios" ? { image } : {};
}

function projectActionId(option: ProjectOption): string {
  return `project:${encodeURIComponent(option.identity)}`;
}

export function QuickCaptureProjectMenu({
  selectedProject,
  projectOptions,
  onChange,
}: Props) {
  const { colors } = useSettings();
  const projects = useMemo(() => {
    const identities = projectOptions.map((option) => option.identity);
    return deriveProjectOptions(
      selectedProject === undefined
        ? identities
        : [selectedProject, ...identities],
    );
  }, [projectOptions, selectedProject]);
  const selectedKey =
    selectedProject === undefined
      ? undefined
      : canonicalProjectKey(selectedProject);
  const projectActions: MenuAction[] = projects.map((project) => ({
    id: projectActionId(project),
    title: project.label,
    ...(projectOptionLabel(project, projects) === project.label
      ? {}
      : { subtitle: project.path }),
    ...actionImage("folder"),
    state:
      selectedKey === canonicalProjectKey(project.identity)
        ? ("on" as const)
        : ("off" as const),
  }));
  const actions: MenuAction[] = [
    ...(selectedProject === undefined
      ? []
      : [
          {
            id: "remove",
            title: "Remove Added Project",
            ...actionImage("minus.circle"),
          },
        ]),
    ...(projectActions.length === 0
      ? [
          {
            id: "empty",
            title: "No Existing Projects",
            attributes: { disabled: true },
          },
        ]
      : projectActions),
  ];
  let displayValue = "Add Project";
  if (selectedKey !== undefined) {
    const selectedOption = projects.find(
      (project) => canonicalProjectKey(project.identity) === selectedKey,
    );
    if (selectedOption === undefined) {
      throw new Error(`Selected Quick Capture project is unavailable`);
    }
    displayValue = projectOptionLabel(selectedOption, projects);
  }

  return (
    <MenuView
      title="Project"
      style={styles.menu}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        feedbackSelection();
        if (nativeEvent.event === "remove") {
          onChange(undefined);
          return;
        }
        const project = projects.find(
          (candidate) => projectActionId(candidate) === nativeEvent.event,
        );
        if (project === undefined) {
          throw new Error(
            `Unknown Quick Capture project action: ${nativeEvent.event}`,
          );
        }
        onChange(project.identity);
      }}
      testID="quick-add-project-menu"
    >
      <View
        style={[
          styles.control,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={
          selectedProject === undefined
            ? "Add project"
            : `Added project: ${displayValue}`
        }
        accessibilityHint="Opens the project menu"
        testID="quick-add-project-control"
      >
        <AppIcon name="briefcase" size={16} color={colors.primary} />
        <Text
          style={[typography.bodySmall, styles.label, { color: colors.text }]}
          numberOfLines={1}
        >
          {displayValue}
        </Text>
        <AppIcon name="chevron-down" size={14} color={colors.textTertiary} />
      </View>
    </MenuView>
  );
}

const styles = StyleSheet.create({
  menu: {
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  control: {
    minHeight: 44,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    flexShrink: 1,
    fontWeight: "600",
  },
});
