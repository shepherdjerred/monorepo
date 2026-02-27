//
//  StringKeyPathMapping+EvaluableConditionContext.swift
//  
//
//  Created by Dominic Go on 12/28/23.
//

import Foundation
import DGSwiftUtilities

extension EvaluableConditionContext: StringKeyPathMapping {

  public static var partialKeyPathMap: Dictionary<String, PartialKeyPath<Self>> = {
    var map: Dictionary<String, PartialKeyPath<Self>> = [
      "windowFrame": \.windowFrame,
      "screenBounds": \.screenBounds,
      "targetViewFrame": \.targetViewFrame,
      "statusBarFrame": \.statusBarFrame,
      "safeAreaInsets": \.safeAreaInsets,
      "interfaceOrientation": \.interfaceOrientation,
      "deviceUserInterfaceIdiom": \.deviceUserInterfaceIdiom,
      "deviceOrientation": \.deviceOrientation,
      "horizontalSizeClass": \.horizontalSizeClass,
      "verticalSizeClass": \.verticalSizeClass,
      "interfaceStyle": \.interfaceStyle,
      "interfaceLevel": \.interfaceLevel,
      "activeAppearance": \.activeAppearance,
      "layoutDirection": \.layoutDirection,
      "hasNotch": \.hasNotch,
      "isLowPowerModeEnabled": \.isLowPowerModeEnabled,
      "isAssistiveTouchRunning": \.isAssistiveTouchRunning,
      "isBoldTextEnabled": \.isBoldTextEnabled,
      "isClosedCaptioningEnabled": \.isClosedCaptioningEnabled,
      "isDarkerSystemColorsEnabled": \.isDarkerSystemColorsEnabled,
      "isGrayscaleEnabled": \.isGrayscaleEnabled,
      "isGuidedAccessEnabled": \.isGuidedAccessEnabled,
      "isInvertColorsEnabled": \.isInvertColorsEnabled,
      "isMonoAudioEnabled": \.isMonoAudioEnabled,
      "isReduceMotionEnabled": \.isReduceMotionEnabled,
      "isReduceTransparencyEnabled": \.isReduceTransparencyEnabled,
      "isShakeToUndoEnabled": \.isShakeToUndoEnabled,
      "isSpeakScreenEnabled": \.isSpeakScreenEnabled,
      "isSpeakSelectionEnabled": \.isSpeakSelectionEnabled,
      "isSwitchControlRunning": \.isSwitchControlRunning,
      "isVoiceOverRunning": \.isVoiceOverRunning,
    ];
    
    if #available(iOS 13.0, *) {
      map["isOnOffSwitchLabelsEnabled"] = \.isOnOffSwitchLabelsEnabled;
      map["isVideoAutoplayEnabled"] = \.isVideoAutoplayEnabled;
      map["shouldDifferentiateWithoutColor"] = \.shouldDifferentiateWithoutColor;
    };
    
    if #available(iOS 14.0, *) {
      map["buttonShapesEnabled"] = \.buttonShapesEnabled;
      map["prefersCrossFadeTransitions"] = \.prefersCrossFadeTransitions;
    };
    
    return map;
  }();
};
