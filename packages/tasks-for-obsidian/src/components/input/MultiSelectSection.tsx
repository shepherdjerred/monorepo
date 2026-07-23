import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";
import { useSettings } from "../../hooks/use-settings";
import { feedbackSelection } from "../../lib/feedback";

export function toggleInArray<T>(arr: readonly T[] | undefined, item: T): T[] {
  const current = arr ?? [];
  return current.includes(item)
    ? current.filter((x) => x !== item)
    : [...current, item];
}

type Props<T extends string> = {
  title: string;
  items: readonly T[];
  selected: readonly T[] | undefined;
  labelFn: (item: T) => string;
  onToggle: (item: T) => void;
  /** Enables a free-text "add" input at the end of the chip row. */
  onCreate?: ((value: string) => void) | undefined;
  createPlaceholder?: string | undefined;
  /**
   * Equivalence for hiding available items already covered by a selected
   * value (e.g. wikilink vs display-name project spellings). Defaults to
   * strict equality.
   */
  matches?: ((selectedValue: T, item: T) => boolean) | undefined;
  testIDPrefix?: string | undefined;
};

/**
 * Wrapping chip multi-select: selected values first, then remaining
 * available items. Shared by the filter modal and the task edit form.
 */
export function MultiSelectSection<T extends string>({
  title,
  items,
  selected,
  labelFn,
  onToggle,
  onCreate,
  createPlaceholder,
  matches,
  testIDPrefix,
}: Props<T>) {
  const { colors } = useSettings();
  const reducedMotion = useReducedMotion();
  const [draft, setDraft] = useState("");

  const current = selected ?? [];
  const matcher = matches ?? ((a: T, b: T): boolean => a === b);
  const available = items.filter(
    (item) => !current.some((s) => matcher(s, item)),
  );
  const chips = [...current, ...available];

  if (chips.length === 0 && !onCreate) return null;

  const handleCreate = (): void => {
    const value = draft.trim();
    if (!value) return;
    feedbackSelection();
    onCreate?.(value);
    setDraft("");
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        {title}
      </Text>
      <View style={styles.chips}>
        {chips.map((item) => {
          const isSelected = current.includes(item);
          return (
            <Animated.View
              key={item}
              {...(reducedMotion
                ? {}
                : {
                    entering: FadeIn.duration(150),
                    exiting: FadeOut.duration(100),
                  })}
            >
              <Pressable
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected
                      ? colors.primary
                      : colors.surface,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  feedbackSelection();
                  onToggle(item);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={labelFn(item)}
                testID={
                  testIDPrefix ? `${testIDPrefix}-chip-${item}` : undefined
                }
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: isSelected ? "#ffffff" : colors.text },
                  ]}
                >
                  {labelFn(item)}
                </Text>
              </Pressable>
            </Animated.View>
          );
        })}
        {onCreate ? (
          <TextInput
            style={[
              styles.chip,
              styles.createInput,
              {
                color: colors.text,
                borderColor: colors.borderLight,
                backgroundColor: colors.surface,
              },
            ]}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleCreate}
            placeholder={createPlaceholder ?? "Add…"}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            submitBehavior="submit"
            accessibilityLabel={`Add new ${title.toLowerCase()}`}
            testID={testIDPrefix ? `${testIDPrefix}-add` : undefined}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  createInput: {
    fontSize: 13,
    minWidth: 72,
    paddingVertical: 4,
    borderStyle: "dashed",
  },
});
