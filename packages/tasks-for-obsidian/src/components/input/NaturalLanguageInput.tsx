import React, { useMemo } from "react";
import { View, TextInput, Text, Pressable, StyleSheet } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import type { NlpParseResult } from "../../domain/types";
import type { FeatherIconName } from "@react-native-vector-icons/feather";
import { PRIORITY_LABELS } from "../../domain/priority";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { feedbackSelection } from "../../lib/feedback";
import { AppIcon } from "../common/AppIcon";

type NaturalLanguageInputProps = {
  value: string;
  onChange: (text: string) => void;
  parsedResult?: NlpParseResult;
  availableProjects?: readonly string[] | undefined;
  availableContexts?: readonly string[] | undefined;
  availableTags?: readonly string[] | undefined;
  testID?: string | undefined;
};

type Badge = { key: string; icon: FeatherIconName; label: string };

type Suggestion = { key: string; token: string; label: string };

const MAX_SUGGESTIONS = 5;

/**
 * Complete the trailing `p:`/`@`/`#` token against known names. Names with
 * spaces are skipped — the word-based grammar cannot parse them back.
 */
function buildSuggestions(
  value: string,
  projects: readonly string[],
  contexts: readonly string[],
  tags: readonly string[],
): Suggestion[] {
  const lastToken = value.split(/\s+/).at(-1) ?? "";
  const make = (
    prefix: string,
    names: readonly string[],
    typed: string,
  ): Suggestion[] => {
    const lower = typed.toLowerCase();
    return names
      .filter(
        (name) =>
          !name.includes(" ") &&
          name.toLowerCase().startsWith(lower) &&
          name.toLowerCase() !== lower,
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((name) => ({
        key: `${prefix}${name}`,
        token: `${prefix}${name}`,
        label: `${prefix}${name}`,
      }));
  };

  if (lastToken.startsWith("p:") && lastToken.length > 2) {
    return make("p:", projects, lastToken.slice(2));
  }
  if (lastToken.startsWith("@") && lastToken.length > 1) {
    return make("@", contexts, lastToken.slice(1));
  }
  if (lastToken.startsWith("#") && lastToken.length > 1) {
    return make("#", tags, lastToken.slice(1));
  }
  return [];
}

export function NaturalLanguageInput({
  value,
  onChange,
  parsedResult,
  availableProjects,
  availableContexts,
  availableTags,
  testID,
}: NaturalLanguageInputProps) {
  const { colors } = useSettings();
  const reducedMotion = useReducedMotion();

  const badges: Badge[] = [];
  if (parsedResult?.due) {
    badges.push({ key: "due", icon: "calendar", label: parsedResult.due });
  }
  if (parsedResult?.priority) {
    badges.push({
      key: "priority",
      icon: "flag",
      label: PRIORITY_LABELS[parsedResult.priority],
    });
  }
  for (const p of parsedResult?.projects ?? []) {
    badges.push({ key: `p-${p}`, icon: "briefcase", label: p });
  }
  for (const c of parsedResult?.contexts ?? []) {
    badges.push({ key: `c-${c}`, icon: "at-sign", label: c });
  }
  for (const t of parsedResult?.tags ?? []) {
    badges.push({ key: `t-${t}`, icon: "hash", label: t });
  }

  const suggestions = useMemo(
    () =>
      buildSuggestions(
        value,
        availableProjects ?? [],
        availableContexts ?? [],
        availableTags ?? [],
      ),
    [value, availableProjects, availableContexts, availableTags],
  );

  const applySuggestion = (suggestion: Suggestion): void => {
    feedbackSelection();
    const lastToken = value.split(/\s+/).at(-1) ?? "";
    onChange(
      `${value.slice(0, value.length - lastToken.length)}${suggestion.token} `,
    );
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder="Buy groceries #shopping @errands !high tomorrow"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        testID={testID}
      />
      {suggestions.length > 0 ? (
        <View
          style={[
            styles.suggestions,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          testID="nlp-suggestions"
        >
          {suggestions.map((suggestion) => (
            <Animated.View
              key={suggestion.key}
              {...(reducedMotion ? {} : { entering: FadeIn.duration(120) })}
            >
              <Pressable
                style={[
                  styles.suggestionRow,
                  { borderBottomColor: colors.borderLight },
                ]}
                onPress={() => {
                  applySuggestion(suggestion);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Autocomplete ${suggestion.label}`}
                testID={`nlp-suggestion-${suggestion.label}`}
              >
                <Text style={[typography.body, { color: colors.text }]}>
                  {suggestion.label}
                </Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      ) : null}
      {badges.length > 0 ? (
        <View style={styles.badges}>
          {badges.map((badge) => (
            <Animated.View
              key={badge.key}
              {...(reducedMotion ? {} : { entering: FadeIn.duration(120) })}
              style={[styles.badge, { backgroundColor: colors.primaryLight }]}
            >
              <AppIcon name={badge.icon} size={12} color="#ffffff" />
              <Text style={styles.badgeText}>{badge.label}</Text>
            </Animated.View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  input: {
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  suggestions: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  suggestionRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
});
