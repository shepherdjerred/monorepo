/**
 * Scout for LoL Shared UI Components
 *
 * This package provides shared React components for the sound pack editor
 * that can be used in both the desktop app and the web frontend.
 */

// Types
export type {
  SoundPackAdapter,
  Champion,
  LocalPlayer,
  CacheStatus,
} from "./types/adapter.ts";

// Hooks
export {
  SoundPackEditorProvider,
  useSoundPackEditor,
} from "./hooks/use-sound-pack-editor.tsx";

// Components
export {
  SoundPackEditor,
  VolumeSlider,
  SoundEntryCard,
  SoundPoolEditor,
  RuleEditor,
  ConditionBuilder,
} from "./components/sound-pack-editor/index.ts";
