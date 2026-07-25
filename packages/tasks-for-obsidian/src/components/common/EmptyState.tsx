import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { ZoomIn, useReducedMotion } from "react-native-reanimated";
import type { FeatherIconName } from "@react-native-vector-icons/feather";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { AppIcon } from "./AppIcon";

export type EmptyStateProps = {
  title: string;
  subtitle?: string | undefined;
  icon?: FeatherIconName | undefined;
  /** Celebration accent: icon renders in the success color with a pop-in. */
  celebrate?: boolean | undefined;
};

export function EmptyState({
  title,
  subtitle,
  icon,
  celebrate = false,
}: EmptyStateProps) {
  const { colors } = useSettings();
  const reducedMotion = useReducedMotion();

  return (
    <View style={styles.container}>
      {icon ? (
        <Animated.View
          {...(reducedMotion || !celebrate
            ? {}
            : { entering: ZoomIn.springify().damping(12).stiffness(300) })}
          style={styles.icon}
        >
          <AppIcon
            name={icon}
            size={40}
            color={celebrate ? colors.success : colors.textTertiary}
          />
        </Animated.View>
      ) : null}
      <Text style={[typography.subheading, { color: colors.textSecondary }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={[
            typography.bodySmall,
            styles.subtitle,
            { color: colors.textTertiary },
          ]}
        >
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
  icon: {
    marginBottom: 12,
  },
  subtitle: {
    marginTop: 8,
    textAlign: "center",
  },
});
