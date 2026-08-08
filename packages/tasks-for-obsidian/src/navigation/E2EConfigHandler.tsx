import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { TIPS_DISABLED_KEY } from "../hooks/use-tip";
import { useSettingsContext } from "../state/SettingsContext";
import { parseE2EConfigUrl } from "./e2e-config";
import { navigationRef } from "./navigation-ref";

/**
 * __DEV__-only deep link that lets the Maestro e2e harness point the app at
 * a local test server without driving the Settings UI:
 *
 *   tasknotes://e2e-config?apiUrl=<url>&token=<token>&nonce=<flow>
 *
 * On receipt (only in dev builds) it persists the API URL + auth token via
 * the normal SettingsContext setters and lands on the Today tab. The path is
 * intentionally absent from `linking.ts`, so React Navigation ignores it; in
 * production builds this component renders nothing and attaches no listener.
 */

export function E2EConfigHandler() {
  const { setApiUrl, setAuthToken } = useSettingsContext();
  const [readyNonce, setReadyNonce] = useState<string | null>(null);

  useEffect(() => {
    if (!__DEV__) return;

    async function applyConfig(url: string): Promise<void> {
      const config = parseE2EConfigUrl(url);
      if (config === null) return;
      setReadyNonce(null);
      if (config.tipsOff) {
        await AsyncStorage.setItem(TIPS_DISABLED_KEY, "true");
      }
      await setApiUrl(config.apiUrl);
      await setAuthToken(config.token);
      if (navigationRef.isReady()) {
        navigationRef.navigate("Main", { screen: "Today" });
      }
      setReadyNonce(config.nonce);
    }

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyConfig(url);
    });
    // Also handle the case where the config link launched the app.
    void (async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl !== null) await applyConfig(initialUrl);
    })();

    return () => {
      subscription.remove();
    };
  }, [setApiUrl, setAuthToken]);

  if (readyNonce === null) return null;
  return (
    <View
      style={styles.readyMarker}
      pointerEvents="none"
      accessible
      accessibilityLabel={`E2E config ready ${readyNonce}`}
      testID={`e2e-config-ready-${readyNonce}`}
    />
  );
}

const styles = StyleSheet.create({
  readyMarker: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0.02,
    zIndex: 10_000,
  },
});
