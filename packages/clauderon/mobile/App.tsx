import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from './src/contexts/SessionContext';
import { AppNavigator } from './src/navigation/AppNavigator';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar barStyle="light-content" backgroundColor="#1e40af" />
        <AppNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

export default App;
