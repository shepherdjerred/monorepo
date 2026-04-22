import React from "react";
import {
  Feather,
  type FeatherIconName,
} from "@react-native-vector-icons/feather";

type AppIconProps = {
  name: FeatherIconName;
  size?: number;
  color?: string;
};

export function AppIcon({ name, size = 20, color = "#000000" }: AppIconProps) {
  return <Feather name={name} size={size} color={color} />;
}
