import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";

import { useSettings } from "../hooks/use-settings";
import { AppIcon } from "../components/common/AppIcon";
import { linking } from "./linking";
import { navigationRef } from "./navigation-ref";
import { MainTabNavigator } from "./main-tabs";
import type { MainTabParamList, RootStackParamList } from "./types";
import { PlatformSymbol } from "../components/common/PlatformSymbol";

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
import { ContextDetailScreen } from "../screens/ContextDetailScreen";
import { TagDetailScreen } from "../screens/TagDetailScreen";
import { SavedViewScreen } from "../screens/SavedViewScreen";
import { JobSearchKanbanScreen } from "../screens/JobSearchKanbanScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

type MainTabsProps = NativeStackScreenProps<RootStackParamList, "Main">;

function MainTabs({ navigation }: MainTabsProps) {
  const { colors } = useSettings();

  return (
    <MainTabNavigator.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarStyle: { backgroundColor: colors.tabBarBackground },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarIcon: ({ color, focused, size }) => (
          <PlatformSymbol
            symbol={tabSymbol(route.name, focused)}
            fallback={tabFallbackIcon(route.name)}
            size={size}
            color={color}
          />
        ),
        headerRight: () => (
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                navigation.navigate("Search");
              }}
              hitSlop={8}
              testID="header-search"
              accessibilityRole="button"
              accessibilityLabel="Search"
            >
              <AppIcon name="search" size={22} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={() => {
                navigation.navigate("Settings");
              }}
              hitSlop={8}
              testID="tab-settings"
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <AppIcon name="settings" size={22} color={colors.text} />
            </Pressable>
          </View>
        ),
      })}
    >
      <MainTabNavigator.Screen
        name="Inbox"
        component={InboxScreen}
        options={{ title: "Inbox", tabBarButtonTestID: "tab-inbox" }}
      />
      <MainTabNavigator.Screen
        name="Today"
        component={TodayScreen}
        options={{ title: "Today", tabBarButtonTestID: "tab-today" }}
      />
      <MainTabNavigator.Screen
        name="Upcoming"
        component={UpcomingScreen}
        options={{ title: "Upcoming", tabBarButtonTestID: "tab-upcoming" }}
      />
      <MainTabNavigator.Screen
        name="Browse"
        component={BrowseScreen}
        options={{ title: "Browse", tabBarButtonTestID: "tab-browse" }}
      />
    </MainTabNavigator.Navigator>
  );
}

function tabFallbackIcon(
  route: keyof MainTabParamList,
): "inbox" | "calendar" | "clock" | "grid" {
  switch (route) {
    case "Inbox":
      return "inbox";
    case "Today":
      return "calendar";
    case "Upcoming":
      return "clock";
    case "Browse":
      return "grid";
  }
}

function tabSymbol(route: keyof MainTabParamList, focused: boolean): string {
  switch (route) {
    case "Inbox":
      return focused ? "tray.fill" : "tray";
    case "Today":
      return "calendar";
    case "Upcoming":
      return "calendar.badge.clock";
    case "Browse":
      return focused ? "square.grid.2x2.fill" : "square.grid.2x2";
  }
}

export const AppNavigator = React.memo(function AppNavigatorComponent() {
  const { colors, isDarkMode } = useSettings();

  return (
    <NavigationContainer
      ref={navigationRef}
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
          headerTransparent: false,
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="Main"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="TaskDetail"
          component={TaskDetailScreen}
          options={{
            title: "Task",
            presentation: "formSheet",
            sheetAllowedDetents: [0.75, 1],
            sheetInitialDetentIndex: "last",
            sheetGrabberVisible: true,
            headerBackButtonMenuEnabled: false,
          }}
        />
        <Stack.Screen
          name="ProjectDetail"
          component={ProjectDetailScreen}
          options={{ title: "Project", headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="ContextDetail"
          component={ContextDetailScreen}
          options={{ title: "Context", headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="TagDetail"
          component={TagDetailScreen}
          options={{ title: "Tag", headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="SavedView"
          component={SavedViewScreen}
          options={{ title: "Saved View", headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="JobSearchKanban"
          component={JobSearchKanbanScreen}
          options={{ title: "Job Search Board" }}
        />
        <Stack.Screen
          name="QuickAdd"
          component={QuickAddScreen}
          options={{
            title: "Quick Add",
            presentation: "formSheet",
            sheetAllowedDetents: [0.55, 0.9],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: "Search", headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: "Settings", headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="Pomodoro"
          component={PomodoroScreen}
          options={{ title: "Pomodoro" }}
        />
        <Stack.Screen
          name="TimeReport"
          component={TimeReportScreen}
          options={{ title: "Time Report", headerLargeTitleEnabled: true }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
});

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    gap: 12,
  },
});
