import { trigger, HapticFeedbackTypes } from "react-native-haptic-feedback";
import Sound from "react-native-sound";

let feedbackEnabled = true;

let completeSound: Sound | null = null;
let createSound: Sound | null = null;
let deleteSound: Sound | null = null;

export function setFeedbackGlobalEnabled(enabled: boolean): void {
  feedbackEnabled = enabled;
}

export function initFeedback(): void {
  Sound.setCategory("Ambient");

  completeSound = new Sound("complete.wav", Sound.MAIN_BUNDLE);
  createSound = new Sound("create.wav", Sound.MAIN_BUNDLE);
  deleteSound = new Sound("delete.wav", Sound.MAIN_BUNDLE);
}

function haptic(type: HapticFeedbackTypes): void {
  if (!feedbackEnabled) return;
  trigger(type, {
    enableVibrateFallback: true,
    ignoreAndroidSystemSettings: false,
  });
}

function playSound(sound: Sound | null): void {
  if (!feedbackEnabled || !sound) return;
  sound.stop(() => {
    sound.play();
  });
}

export function feedbackTaskComplete(): void {
  haptic(HapticFeedbackTypes.notificationSuccess);
  playSound(completeSound);
}

export function feedbackTaskUncomplete(): void {
  haptic(HapticFeedbackTypes.impactLight);
}

export function feedbackTaskCreate(): void {
  haptic(HapticFeedbackTypes.notificationSuccess);
  playSound(createSound);
}

export function feedbackTaskDelete(): void {
  haptic(HapticFeedbackTypes.notificationWarning);
  playSound(deleteSound);
}

export function feedbackButtonPress(): void {
  haptic(HapticFeedbackTypes.impactLight);
}

export function feedbackSelection(): void {
  haptic(HapticFeedbackTypes.selection);
}

export function feedbackError(): void {
  haptic(HapticFeedbackTypes.notificationError);
}

export function feedbackPullToRefresh(): void {
  haptic(HapticFeedbackTypes.impactMedium);
}
