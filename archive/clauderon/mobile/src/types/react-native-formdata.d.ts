/**
 * Extend FormData to accept React Native file objects.
 *
 * React Native's FormData implementation accepts objects with
 * { uri, type, name } for file uploads, which differs from the
 * standard web FormData API that only accepts Blob/File.
 */

export {};

type ReactNativeFileObject = {
  uri: string;
  type: string;
  name: string;
};

declare global {
  interface FormData {
    append(name: string, value: ReactNativeFileObject): void;
  }
}
