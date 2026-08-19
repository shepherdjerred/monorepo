import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";

type ConnectionStatusProps = {
  isConnected: boolean;
  label?: string;
};

export function ConnectionStatus({ isConnected, label = "Daemon" }: ConnectionStatusProps) {
  return (
    <View style={styles.container}>
      <View
        style={[styles.indicator, { backgroundColor: isConnected ? colors.success : colors.error }]}
      />
      <Text style={styles.label}>
        {label}: {isConnected ? "Connected" : "Disconnected"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.textDark,
    textTransform: "uppercase",
  },
});
