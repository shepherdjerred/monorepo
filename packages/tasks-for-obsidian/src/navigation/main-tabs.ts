import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { NavigationProp, RouteProp } from "@react-navigation/native";

import type { MainTabParamList } from "./types";

export const MainTabNavigator = createBottomTabNavigator<MainTabParamList>();

export type MainTabScreenProps<RouteName extends keyof MainTabParamList> = {
  navigation: NavigationProp<MainTabParamList, RouteName>;
  route: RouteProp<MainTabParamList, RouteName>;
};
