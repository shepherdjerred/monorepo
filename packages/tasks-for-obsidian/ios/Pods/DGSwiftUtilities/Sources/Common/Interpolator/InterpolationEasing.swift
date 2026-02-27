//
//  InterpolationEasing.swift
//  
//
//  Created by Dominic Go on 7/10/24.
//

import Foundation


public enum InterpolationEasing {
  
  case linear;
  
  case easeInCustom(amount: CGFloat);
  case easeOutCustom(amount: CGFloat);
  case easeInOutCustom(easeInAmount: CGFloat, easeOutAmount: CGFloat);
  
  /// amount: 0.1 = slowest, 1 = linear, 10 = fastest
  case easeInOutExpoCustom(amount: CGFloat)
  
  case customFunction(_ easingFn: (CGFloat) -> CGFloat);
  
  case easeInSine;
  case easeOutSine;
  case easeInOutSine;
  
  case easeInQuad;
  case easeOutQuad;
  case easeInOutQuad;
  
  case easeInCubic;
  case easeOutCubic;
  case easeInOutCubic;
  
  case easeInQuart;
  case easeOutQuart;
  case easeInOutQuart;
  
  case easeInQuint;
  case easeOutQuint;
  case easeInOutQuint;
  
  case easeInExpo;
  case easeOutExpo;
  case easeInOutExpo;
  
  public func compute(percentValue: CGFloat) -> CGFloat {
    switch self {
      case .linear:
        return percentValue;
        
      case let .easeInCustom(amount):
        return pow(percentValue, amount);
        
      case let .easeOutCustom(amount):
        let exp = amount / 2;
        return pow(percentValue, exp);
        
      case let .easeInOutCustom(easeInAmount, easeOutAmount):
        let easeInConfig: Self = .easeInCustom(amount: easeInAmount);
        let easeOutConfig: Self = .easeOutCustom(amount: easeOutAmount);
        
        let easeIn = easeInConfig.compute(percentValue: percentValue);
        let easeOut = easeOutConfig.compute(percentValue: percentValue);
        
        return InterpolatorHelpers.lerp(
          valueStart: easeIn,
          valueEnd: easeOut,
          percent: percentValue
        );
        
      case let .easeInOutExpoCustom(amount):
        if percentValue < 0.5 {
          return pow(percentValue * 2, amount) / 2;
        };
        
        return 1 - pow(2 - percentValue * 2, amount) / 2;
        
      case let .customFunction(easingFn):
        return easingFn(percentValue);
        
      case .easeInSine:
        return 1 - cos((percentValue * CGFloat.pi) / 2);
        
      case .easeOutSine:
        return sin((percentValue * CGFloat.pi) / 2);
        
      case .easeInOutSine:
        return -(cos(CGFloat.pi * percentValue) - 1) / 2;
        
      case .easeInQuad:
        return percentValue * percentValue;
        
      case .easeOutQuad:
        return 1 - (1 - percentValue) * (1 - percentValue);
        
      case .easeInOutQuad:
        if percentValue < 0.5 {
          return 2 * percentValue * percentValue;
        };
        
        return 1 - pow(-2 * percentValue + 2, 2) / 2;
        
      case .easeInCubic:
        return percentValue * percentValue * percentValue;
        
      case .easeOutCubic:
        return  1 - pow(1 - percentValue, 3);
        
      case .easeInOutCubic:
        if percentValue < 0.5 {
          return 4 * percentValue * percentValue * percentValue;
        };
        
        return 1 - pow(-2 * percentValue + 2, 3) / 2;
        
      case .easeInQuart:
        return percentValue * percentValue * percentValue * percentValue;
        
      case .easeOutQuart:
        return 1 - pow(1 - percentValue, 4);
        
      case .easeInOutQuart:
        if percentValue < 0.5 {
          return 8 * percentValue * percentValue * percentValue * percentValue;
        };
        
        return 1 - pow(-2 * percentValue + 2, 4) / 2;
        
      case .easeInQuint:
        return percentValue * percentValue * percentValue * percentValue * percentValue;
        
      case .easeOutQuint:
        return 1 - pow(1 - percentValue, 5);
        
      case .easeInOutQuint:
        if percentValue < 0.5 {
          return 16 * percentValue * percentValue * percentValue * percentValue * percentValue;
        };
        
        return 1 - pow(-2 * percentValue + 2, 5) / 2;
        
      case .easeInExpo:
        if percentValue.asWholeNumberExact == 0 {
          return 0;
        };
        
        return pow(2, 10 * percentValue - 10);
        
      case .easeOutExpo:
        if percentValue.asWholeNumberExact == 1 {
          return 1;
        };
        
        return 1 - pow(2, -10 * percentValue);
        
      case .easeInOutExpo:
        if percentValue.asWholeNumberExact == 0 {
          return 0;
        };
        
        if percentValue.asWholeNumberExact == 1 {
          return 1;
        };
        
        if percentValue < 0.5 {
          return pow(2, 20 * percentValue - 10) / 2;
        };
        
        return (2 - pow(2, -20 * percentValue + 10)) / 2;
    };
  };
};

