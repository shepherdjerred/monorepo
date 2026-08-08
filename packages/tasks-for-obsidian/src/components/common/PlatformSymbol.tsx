import React from "react";
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  UIManager,
  View,
} from "react-native";
import type { ViewProps } from "react-native";
import type { FeatherIconName } from "@react-native-vector-icons/feather";

import { AppIcon } from "./AppIcon";

type NativeSymbolProps = ViewProps & {
  readonly symbolName: string;
  readonly symbolSize: number;
  readonly symbolWeight: string;
  readonly tintColorHex: string;
};

const NativeSymbolView =
  requireNativeComponent<NativeSymbolProps>("SFSymbolView");
const nativeSymbolViewAvailable =
  UIManager.hasViewManagerConfig("SFSymbolView");

type Props = {
  readonly symbol: string;
  readonly fallback: FeatherIconName;
  readonly size: number;
  readonly color: string;
};

export function PlatformSymbol({ symbol, fallback, size, color }: Props) {
  if (!nativeSymbolViewAvailable || Platform.OS !== "ios") {
    return <AppIcon name={fallback} size={size} color={color} />;
  }

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      <NativeSymbolView
        style={StyleSheet.absoluteFill}
        symbolName={symbol}
        symbolSize={size}
        symbolWeight="semibold"
        tintColorHex={color}
      />
    </View>
  );
}
