import React, { useCallback, useMemo } from "react";
import { View } from "react-native";
import { projectMatches } from "tasknotes-types/v2";

import {
  deriveProjectOptions,
  projectIdentityLabel,
} from "../../domain/project-options";
import { useSettings } from "../../hooks/use-settings";
import { MultiSelectSection, toggleInArray } from "../input/MultiSelectSection";
import type { TaskDetailDraft } from "./task-detail-draft";
import { taskDetailStyles as styles } from "./task-detail-styles";
import { SectionTitle } from "./TaskDetailControls";

type Props = {
  readonly draft: TaskDetailDraft;
  readonly availableProjects: readonly string[];
  readonly availableContexts: readonly string[];
  readonly availableTags: readonly string[];
  readonly onChange: (draft: TaskDetailDraft) => void;
};

export function TaskDetailOrganize({
  draft,
  availableProjects,
  availableContexts,
  availableTags,
  onChange,
}: Props) {
  const { colors } = useSettings();
  const projectOptions = useMemo(
    () => deriveProjectOptions([...availableProjects, ...draft.projects]),
    [availableProjects, draft.projects],
  );
  const toggleProject = useCallback(
    (item: string) => {
      const selected = draft.projects.find((project) =>
        projectMatches(project, item),
      );
      onChange({
        ...draft,
        projects:
          selected === undefined
            ? [...draft.projects, item]
            : draft.projects.filter((project) => project !== selected),
      });
    },
    [draft, onChange],
  );

  return (
    <>
      <SectionTitle>Organize</SectionTitle>
      <View
        style={[
          styles.card,
          styles.chipCard,
          { backgroundColor: colors.surface },
        ]}
      >
        <MultiSelectSection
          title="Projects"
          items={availableProjects}
          selected={draft.projects}
          labelFn={(project) => projectIdentityLabel(project, projectOptions)}
          matches={projectMatches}
          onToggle={toggleProject}
          onCreate={(value) => {
            if (
              !draft.projects.some((project) => projectMatches(project, value))
            ) {
              onChange({ ...draft, projects: [...draft.projects, value] });
            }
          }}
          createPlaceholder="Add project…"
          testIDPrefix="task-detail-projects"
        />
        <MultiSelectSection
          title="Contexts"
          items={availableContexts}
          selected={draft.contexts}
          labelFn={(context) => `@${context}`}
          onToggle={(context) => {
            onChange({
              ...draft,
              contexts: toggleInArray(draft.contexts, context),
            });
          }}
          onCreate={(value) => {
            if (!draft.contexts.includes(value)) {
              onChange({ ...draft, contexts: [...draft.contexts, value] });
            }
          }}
          createPlaceholder="Add context…"
          testIDPrefix="task-detail-contexts"
        />
        <MultiSelectSection
          title="Tags"
          items={availableTags}
          selected={draft.tags}
          labelFn={(tag) => `#${tag}`}
          onToggle={(tag) => {
            onChange({ ...draft, tags: toggleInArray(draft.tags, tag) });
          }}
          onCreate={(value) => {
            if (!draft.tags.includes(value)) {
              onChange({ ...draft, tags: [...draft.tags, value] });
            }
          }}
          createPlaceholder="Add tag…"
          testIDPrefix="task-detail-tags"
        />
      </View>
    </>
  );
}
