//
//  ComputableLayoutEvaluableConditionContext.swift
//  
//
//  Created by Dominic Go on 7/31/23.
//

import UIKit

public struct EvaluableConditionContext: Equatable {
  
  public static var `default`: Self = .init(window: nil, targetView: nil);

  // MARK: - Properties
  // ------------------

  public var windowFrame: CGRect?;
  public var screenBounds: CGRect;
  
  public var targetViewFrame: CGRect?;
  
  public var statusBarFrame: CGRect?;
  public var safeAreaInsets: UIEdgeInsets?;
  
  public var interfaceOrientation: UIInterfaceOrientation;
  
  public var deviceUserInterfaceIdiom: UIUserInterfaceIdiom {
    UIDevice.current.userInterfaceIdiom;
  };
  
  public var deviceOrientation: UIDeviceOrientation {
    UIDevice.current.orientation;
  };
  
  public var horizontalSizeClass: UIUserInterfaceSizeClass?;
  public var verticalSizeClass: UIUserInterfaceSizeClass?;
  
  public var interfaceStyle:
    EvaluableCondition.UserInterfaceStyle;
    
  public var interfaceLevel:
    EvaluableCondition.UserInterfaceLevel;
    
  public var activeAppearance:
    EvaluableCondition.UserInterfaceActiveAppearance?;
  
  public var layoutDirection: UITraitEnvironmentLayoutDirection;
  
  // MARK: - Properties - Flags
  // --------------------------
  
  public var hasNotch: Bool;
  
  public var isLowPowerModeEnabled: Bool {
    ProcessInfo.processInfo.isLowPowerModeEnabled;
  };
  
  // MARK: Flags - Properties - Accessibility-Related
  // ------------------------------------------------
  
  public var isAssistiveTouchRunning: Bool {
    UIAccessibility.isAssistiveTouchRunning;
  };

  public var isBoldTextEnabled: Bool {
    UIAccessibility.isBoldTextEnabled;
  };

  public var isClosedCaptioningEnabled: Bool {
    UIAccessibility.isClosedCaptioningEnabled;
  };

  public var isDarkerSystemColorsEnabled: Bool {
    UIAccessibility.isDarkerSystemColorsEnabled;
  };

  public var isGrayscaleEnabled: Bool {
    UIAccessibility.isGrayscaleEnabled;
  };

  public var isGuidedAccessEnabled: Bool {
    UIAccessibility.isGuidedAccessEnabled;
  };

  public var isInvertColorsEnabled: Bool {
    UIAccessibility.isInvertColorsEnabled;
  };

  public var isMonoAudioEnabled: Bool {
    UIAccessibility.isMonoAudioEnabled;
  };

  @available(iOS 13.0, *)
  public var isOnOffSwitchLabelsEnabled: Bool {
    UIAccessibility.isOnOffSwitchLabelsEnabled;
  };

  public var isReduceMotionEnabled: Bool {
    UIAccessibility.isReduceMotionEnabled;
  };

  public var isReduceTransparencyEnabled: Bool {
    UIAccessibility.isReduceTransparencyEnabled;
  };

  public var isShakeToUndoEnabled: Bool {
    UIAccessibility.isShakeToUndoEnabled;
  };

  public var isSpeakScreenEnabled: Bool {
    UIAccessibility.isSpeakScreenEnabled;
  };

  public var isSpeakSelectionEnabled: Bool {
    UIAccessibility.isSpeakSelectionEnabled;
  };

  public var isSwitchControlRunning: Bool {
    UIAccessibility.isSwitchControlRunning;
  };

  @available(iOS 13.0, *)
  public var isVideoAutoplayEnabled: Bool {
    UIAccessibility.isVideoAutoplayEnabled;
  };

  public var isVoiceOverRunning: Bool {
    UIAccessibility.isVoiceOverRunning;
  };

  @available(iOS 13.0, *)
  public var shouldDifferentiateWithoutColor: Bool {
    UIAccessibility.shouldDifferentiateWithoutColor;
  };

  @available(iOS 14.0, *)
  public var buttonShapesEnabled: Bool {
    UIAccessibility.buttonShapesEnabled;
  };

  @available(iOS 14.0, *)
  public var prefersCrossFadeTransitions: Bool {
    UIAccessibility.prefersCrossFadeTransitions;
  };
};

// MARK: - Extension - Init
// ------------------------

public extension EvaluableConditionContext {

  init(
    window: UIWindow?,
    targetView: UIView?
  ) {
    self.windowFrame = window?.frame ?? .zero;
    self.screenBounds = UIScreen.main.bounds;
    
    self.targetViewFrame = targetView?.frame;
    
    self.statusBarFrame = {
      guard #available(iOS 13.0, *) else {
        return UIApplication.shared.statusBarFrame;
      };
      
      return window?.windowScene?.statusBarManager?.statusBarFrame;
    }();
    
    self.safeAreaInsets = window?.safeAreaInsets;
    
    let interfaceOrientation: UIInterfaceOrientation = {
      var orientation: UIInterfaceOrientation? = nil;
      
      if #available(iOS 13.0, *) {
        orientation = window?.windowScene?.interfaceOrientation;
        
      } else {
        orientation = UIApplication.shared.statusBarOrientation;
      };
      
      return orientation ?? .unknown;
    }();
    
    self.interfaceOrientation = interfaceOrientation;

    let traitCollection = window?.traitCollection;
    
    self.horizontalSizeClass = traitCollection?.horizontalSizeClass;
    self.verticalSizeClass = traitCollection?.verticalSizeClass;
    
    self.interfaceStyle = {
      guard #available(iOS 13.0, *),
            let traitCollection = traitCollection
      else { return .unspecified };
      
      return .init(from: traitCollection.userInterfaceStyle) ?? .unspecified;
    }();
    
    self.interfaceLevel = {
      guard #available(iOS 13.0, *),
            let traitCollection = traitCollection
      else { return .unspecified };
      
      return .init(from: traitCollection.userInterfaceLevel) ?? .unspecified;
    }();
    
    self.activeAppearance = {
      guard #available(iOS 14.0, *),
            let traitCollection = traitCollection
      else { return .unspecified };
      
      return .init(from: traitCollection.activeAppearance) ?? .unspecified;
    }();
    
    self.layoutDirection = traitCollection?.layoutDirection ?? .unspecified;
    
    self.hasNotch = {
      guard let window = window else { return false };
      
      let hasInsetsBottom = window.safeAreaInsets.bottom > 0;
      let hasInsetsLeft   = window.safeAreaInsets.left   > 0;
      let hasInsetsRight  = window.safeAreaInsets.right  > 0;
      
      let hasInsetsHorizontal = hasInsetsLeft || hasInsetsRight;
      
      switch UIDevice.current.userInterfaceIdiom {
        case .phone:
          switch interfaceOrientation {
            case .portrait:
              return hasInsetsBottom && window.safeAreaInsets.top > 20;
              
            case .portraitUpsideDown:
              return hasInsetsBottom;
              
            case .landscapeRight: fallthrough;
            case .landscapeLeft:
              return hasInsetsBottom && hasInsetsHorizontal;
              
            case .unknown: fallthrough;
            @unknown default:
              return false;
          };
            
        default:
          return false;
      };
    }();
  };
  
  init(
    derivedFrom next: Self,
    withBase prev: Self?
  ){
    self.windowFrame = next.windowFrame
      ?? prev?.windowFrame;
      
    self.targetViewFrame = next.targetViewFrame
      ?? prev?.targetViewFrame;
      
    self.statusBarFrame = next.statusBarFrame
      ?? prev?.statusBarFrame;
      
    self.safeAreaInsets = next.safeAreaInsets
      ?? prev?.safeAreaInsets;
      
    self.horizontalSizeClass = next.horizontalSizeClass
      ?? prev?.horizontalSizeClass;
      
    self.verticalSizeClass = next.verticalSizeClass
      ?? prev?.verticalSizeClass;
    
    self.interfaceOrientation = next.interfaceOrientation;
    self.screenBounds = next.screenBounds;
    self.interfaceStyle = next.interfaceStyle;
    self.interfaceLevel = next.interfaceLevel;
    self.activeAppearance = next.activeAppearance;
    self.layoutDirection = next.layoutDirection;
    self.hasNotch = next.hasNotch;
  };
};
