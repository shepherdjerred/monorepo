import { Platform } from "react-native";
import type { Asset, PhotoQuality } from "react-native-image-picker";

/**
 * Cross-platform image picker abstraction
 *
 * Note: Windows support for image picking is limited in React Native.
 * This abstraction provides graceful fallback for unsupported platforms.
 */

export type ImagePickerResult = {
  assets?: Asset[];
  didCancel?: boolean;
  errorMessage?: string;
};

export type ImagePickerOptions = {
  mediaType?: "photo" | "video" | "mixed";
  selectionLimit?: number;
  quality?: PhotoQuality;
  saveToPhotos?: boolean;
};

/**
 * Launch the image library picker
 */
export async function launchImageLibrary(options?: ImagePickerOptions): Promise<ImagePickerResult> {
  // Windows doesn't support react-native-image-picker yet
  if (Platform.OS === "windows") {
    return {
      errorMessage:
        "Image picking is not yet supported on Windows. Please use the iOS, Android, or macOS version to upload images.",
    };
  }

  // For iOS, Android, and macOS, use the native image picker
  const { launchImageLibrary: nativeLaunch } = await import("react-native-image-picker");

  return await nativeLaunch({ mediaType: "photo", ...options });
}

/**
 * Launch the camera
 */
export async function launchCamera(options?: ImagePickerOptions): Promise<ImagePickerResult> {
  // Windows doesn't support react-native-image-picker yet
  if (Platform.OS === "windows") {
    return {
      errorMessage:
        "Camera is not yet supported on Windows. Please use the iOS, Android, or macOS version to take photos.",
    };
  }

  // macOS doesn't typically have cameras (or at least camera access is different)
  if (Platform.OS === "macos") {
    return {
      errorMessage: "Camera is not supported on macOS. Please use the image library instead.",
    };
  }

  // For iOS and Android, use the native camera
  const { launchCamera: nativeLaunch } = await import("react-native-image-picker");

  return await nativeLaunch({ mediaType: "photo", ...options });
}
