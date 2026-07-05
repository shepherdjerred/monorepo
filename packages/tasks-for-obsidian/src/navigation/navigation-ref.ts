import { createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "./types";

// Module-level navigation ref so non-screen code (e.g. the __DEV__-only
// e2e-config deep link handler) can navigate imperatively once the
// NavigationContainer is mounted.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
