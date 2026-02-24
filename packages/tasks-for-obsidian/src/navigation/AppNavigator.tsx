import React from "react";
import { Pressable, Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { useSettings } from "../hooks/useSettings";
import { linking } from "./linking";
import type { RootStackParamList, MainTabParamList } from "./types";

import { InboxScreen } from "../screens/InboxScreen";
import { TodayScreen } from "../screens/TodayScreen";
import { UpcomingScreen } from "../screens/UpcomingScreen";
import { BrowseScreen } from "../screens/BrowseScreen";
import { TaskDetailScreen } from "../screens/TaskDetailScreen";
import { ProjectDetailScreen } from "../screens/ProjectDetailScreen";
import { QuickAddScreen } from "../screens/QuickAddScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { PomodoroScreen } from "../screens/PomodoroScreen";
import { TimeReportScreen } from "../screens/TimeReportScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  const { colors } = useSettings();

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarStyle: { backgroundColor: colors.tabBarBackground },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Tab.Screen name="Inbox" component={InboxScreen} />
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Upcoming" component={UpcomingScreen} />
      <Tab.Screen name="Browse" component={BrowseScreen} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { colors, isDarkMode } = useSettings();

  return (
    <NavigationContainer
      linking={linking}
      theme={{
        dark: isDarkMode,
        colors: {
          primary: colors.primary,
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.error,
        },
        fonts: {
          regular: { fontFamily: "System", fontWeight: "400" },
          medium: { fontFamily: "System", fontWeight: "500" },
          bold: { fontFamily: "System", fontWeight: "700" },
          heavy: { fontFamily: "System", fontWeight: "900" },
        },
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="Main"
          component={MainTabs}
          options={({ navigation: nav }) => ({
            headerShown: true,
            title: "Tasks",
            headerRight: () => (
              <Pressable onPress={() => nav.navigate("Settings")} hitSlop={8}>
                <Text style={{ fontSize: 22 }}>{"⚙"}</Text>
              </Pressable>
            ),
          })}
        />
        <Stack.Screen
          name="TaskDetail"
          component={TaskDetailScreen}
          options={{ title: "Task" }}
        />
        <Stack.Screen
          name="ProjectDetail"
          component={ProjectDetailScreen}
          options={{ title: "Project" }}
        />
        <Stack.Screen
          name="QuickAdd"
          component={QuickAddScreen}
          options={{ title: "Quick Add", presentation: "modal" }}
        />
        <Stack.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: "Search" }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: "Settings" }}
        />
        <Stack.Screen
          name="Pomodoro"
          component={PomodoroScreen}
          options={{ title: "Pomodoro" }}
        />
        <Stack.Screen
          name="TimeReport"
          component={TimeReportScreen}
          options={{ title: "Time Report" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
