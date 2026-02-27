import React, { useCallback, useEffect } from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Sentry from "@sentry/react-native";

import { ApiClientProvider } from "./src/state/ApiClientContext";
import { SettingsProvider } from "./src/state/SettingsContext";
import { SyncProvider } from "./src/state/SyncContext";
import { TaskProvider } from "./src/state/TaskContext";
import { TimeTrackingProvider } from "./src/state/TimeTrackingContext";
import { useSettings } from "./src/hooks/use-settings";
import { useSyncContext } from "./src/state/SyncContext";
import { useAppState } from "./src/hooks/use-app-state";
import { ErrorBoundary } from "./src/components/common/ErrorBoundary";
import { ConnectionBanner } from "./src/components/common/ConnectionBanner";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { initFeedback } from "./src/lib/feedback";

Sentry.init({
  dsn: "", // Provide your Sentry DSN to enable crash reporting
  enabled: !__DEV__,
});

function ThemedApp() {
  const { isDarkMode } = useSettings();
  const { syncNow } = useSyncContext();

  const handleForeground = useCallback(() => {
    void syncNow();
  }, [syncNow]);

  useAppState(handleForeground);

  return (
    <>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <ConnectionBanner />
      <AppNavigator />
    </>
  );
}

function App() {
  useEffect(() => {
    initFeedback();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <SettingsProvider>
            <ApiClientProvider>
              <TaskProvider>
                <SyncProvider>
                  <TimeTrackingProvider>
                    <ThemedApp />
                  </TimeTrackingProvider>
                </SyncProvider>
              </TaskProvider>
            </ApiClientProvider>
          </SettingsProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
