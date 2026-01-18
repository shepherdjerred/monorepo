import React from 'react';
import { StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import { SessionProvider } from './src/contexts/SessionContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SENTRY_DSN } from './src/config';

// Initialize Sentry for error reporting
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
  });
}

function ThemedApp(): React.JSX.Element {
  const { isDark, colors } = useTheme();

  return (
    <SessionProvider>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.primary}
      />
      <AppNavigator />
    </SessionProvider>
  );
}

function App(): React.JSX.Element {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error }) => (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
            An error occurred
          </Text>
          <Text style={{ color: '#666' }}>{error.message}</Text>
        </View>
      )}
    >
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </SafeAreaProvider>
    </Sentry.ErrorBoundary>
  );
}

export default Sentry.wrap(App);
