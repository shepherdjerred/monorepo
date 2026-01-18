import React from "react";
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { RootStackParamList, MainTabParamList } from "../types/navigation";
import { SessionListScreen } from "../screens/SessionListScreen";
import { ChatScreen } from "../screens/ChatScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { CreateSessionScreen } from "../screens/CreateSessionScreen";
import { EditSessionScreen } from "../screens/EditSessionScreen";
import { StatusScreen } from "../screens/StatusScreen";
import { useTheme } from "../contexts/ThemeContext";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textLight,
        tabBarStyle: {
          borderTopWidth: 3,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "bold",
          textTransform: "uppercase",
        },
        headerStyle: {
          backgroundColor: colors.primary,
          borderBottomWidth: 3,
          borderBottomColor: colors.border,
        },
        headerTintColor: colors.textWhite,
        headerTitleStyle: {
          fontWeight: "bold",
        },
      }}
    >
      <Tab.Screen
        name="Sessions"
        component={SessionListScreen}
        options={{
          tabBarLabel: "Sessions",
          title: "Clauderon Sessions",
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: "Settings",
          title: "Settings",
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { isDark, colors } = useTheme();

  // Create a custom navigation theme based on current mode
  const navigationTheme: Theme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.error,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.primary,
          },
          headerTintColor: colors.textWhite,
          headerTitleStyle: {
            fontWeight: "bold",
          },
        }}
      >
        <Stack.Screen
          name="Main"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{ title: "Chat" }}
        />
        <Stack.Screen
          name="CreateSession"
          component={CreateSessionScreen}
          options={{ title: "New Session" }}
        />
        <Stack.Screen
          name="EditSession"
          component={EditSessionScreen}
          options={{ title: "Edit Session" }}
        />
        <Stack.Screen
          name="Status"
          component={StatusScreen}
          options={{ title: "System Status" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
