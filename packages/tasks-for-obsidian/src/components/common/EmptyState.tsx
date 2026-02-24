import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSettings } from "../../hooks/useSettings";
import { typography } from "../../styles/typography";

export type EmptyStateProps = {
  title: string;
  subtitle?: string | undefined;
};

export function EmptyState({ title, subtitle }: EmptyStateProps) {
  const { colors } = useSettings();

  return (
    <View style={styles.container}>
      <Text style={[typography.subheading, { color: colors.textSecondary }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[typography.bodySmall, styles.subtitle, { color: colors.textTertiary }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  subtitle: {
    marginTop: 8,
    textAlign: "center",
  },
});
