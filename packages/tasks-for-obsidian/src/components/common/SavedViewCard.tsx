import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { AppIcon } from "./AppIcon";
import { useSettings } from "../../hooks/use-settings";

type Props = {
  name: string;
  icon: string;
  count: number;
  color: string;
  onPress: () => void;
};

export function SavedViewCard({ name, icon, count, color, onPress }: Props) {
  const { colors } = useSettings();

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
    >
      <View style={[styles.iconCircle, { backgroundColor: color + "1A" }]}>
        <AppIcon name={icon} size={20} color={color} />
      </View>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{name}</Text>
      <Text style={[styles.count, { color: colors.textSecondary }]}>{count} tasks</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
  },
  count: {
    fontSize: 13,
  },
});
