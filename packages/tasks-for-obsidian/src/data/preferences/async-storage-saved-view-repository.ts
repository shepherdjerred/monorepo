import AsyncStorage from "@react-native-async-storage/async-storage";

import { SavedViewRepository } from "./saved-view-repository";

export const savedViewRepository = new SavedViewRepository({
  getItem(key) {
    return AsyncStorage.getItem(key);
  },
  setItem(key, value) {
    return AsyncStorage.setItem(key, value);
  },
});
