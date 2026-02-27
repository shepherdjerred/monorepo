//
//  UIViewAnimate+RawValueToStringConvertible.swift
//  react-native-ios-context-menu
//
//  Created by Dominic Go on 6/18/22.
//

import UIKit

extension UIView.AnimationOptions: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .curveEaseInOut,
    .curveEaseIn,
    .curveEaseOut,
    .curveLinear,
    
    .layoutSubviews,
    .allowUserInteraction,
    .beginFromCurrentState,
    .repeat,
    .autoreverse,
    .overrideInheritedDuration,
    .overrideInheritedCurve,
    .allowAnimatedContent,
    .showHideTransitionViews,
    .overrideInheritedOptions,
    
    .transitionFlipFromLeft,
    .transitionFlipFromRight,
    .transitionCurlUp,
    .transitionCurlDown,
    .transitionCrossDissolve,
    .transitionFlipFromTop,
    .transitionFlipFromBottom,
    
    .preferredFramesPerSecond60,
    .preferredFramesPerSecond30,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .curveEaseIn:
        return "curveEaseIn";

      case .curveEaseOut:
        return "curveEaseOut";

      case .curveEaseInOut:
        return "curveEaseInOut";

      case .curveLinear:
        return "curveLinear";

      case .layoutSubviews:
          return "layoutSubviews";
          
      case .allowUserInteraction:
        return "allowUserInteraction";
        
      case .beginFromCurrentState:
        return "beginFromCurrentState";
        
      case .repeat:
        return "repeat";
          
      case .autoreverse:
        return "autoreverse";
          
      case .overrideInheritedDuration:
        return "overrideInheritedDuration";
        
      case .overrideInheritedCurve:
        return "overrideInheritedCurve";
        
      case .allowAnimatedContent:
        return "allowAnimatedContent";
        
      case .showHideTransitionViews:
        return "showHideTransitionViews";
        
      case .overrideInheritedOptions:
        return "overrideInheritedOptions";
        
      case .transitionFlipFromLeft:
        return "transitionFlipFromLeft";
          
      case .transitionFlipFromRight:
        return "transitionFlipFromRight";
          
      case .transitionCurlUp:
        return "transitionCurlUp";
        
      case .transitionCurlDown:
        return "transitionCurlDown";
          
      case .transitionCrossDissolve:
        return "transitionCrossDissolve";
          
      case .transitionFlipFromTop:
        return "transitionFlipFromTop";
          
      case .transitionFlipFromBottom:
        return "transitionFlipFromBottom";
          

      case .preferredFramesPerSecond60:
        return "preferredFramesPerSecond60";
        
      case .preferredFramesPerSecond30:
        return "preferredFramesPerSecond30";

      default:
        return "unknown";
    };
  };
};
