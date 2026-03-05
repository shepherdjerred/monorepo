import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { AppIcon } from "./AppIcon";
import { useSettings } from "../../hooks/use-settings";

type Props = {
  icon: string;
  name: string;
  count: number;
  onPress: () => void;
};

export function BrowseItem({ icon, name, count, onPress }: Props) {
  const { colors } = useSettings();

  return (
    <Pressable
      style={[styles.container, { borderBottomColor: colors.borderLight }]}
      onPress={onPress}
    >
      <View style={styles.left}>
        <AppIcon name={icon} size={18} color={colors.textSecondary} />
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
      </View>
      <View style={styles.right}>
        {count > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
              {count}
            </Text>
          </View>
        ) : null}
        <AppIcon name="chevron-right" size={18} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  name: {
    fontSize: 16,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "500",
  },
});
