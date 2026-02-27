import React from "react";
import Feather from "react-native-vector-icons/Feather";

type AppIconProps = {
  name: string;
  size?: number;
  color?: string;
};

export function AppIcon({ name, size = 20, color = "#000000" }: AppIconProps) {
  return <Feather name={name} size={size} color={color} />;
}
