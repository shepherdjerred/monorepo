//
//  ComputableLayoutEvaluableCondition.swift
//  
//
//  Created by Dominic Go on 7/28/23.
//

import UIKit
import DGSwiftUtilities


public indirect enum EvaluableCondition: Equatable {

  // MARK: - Embedded Types
  // ----------------------

  // Mirrors: `UIUserInterfaceStyle`
  public enum UserInterfaceStyle: CaseIterable, Equatable {
    case unspecified;
    case dark;
    case light;
    
    @available(iOS 13.0, *)
    var actualValue: UIUserInterfaceStyle {
      switch self {
        case .unspecified: return .unspecified;
        case .dark       : return .dark;
        case .light      : return .light;
      };
    };
    
    @available(iOS 13.0, *)
    init?(from interfaceStyle: UIUserInterfaceStyle) {
      let match = Self.allCases.first {
        $0.actualValue == interfaceStyle;
      };
      
      guard let match = match else { return nil };
      self = match;
    };
  };
  
  // Mirrors: `UIUserInterfaceLevel`
  public enum UserInterfaceLevel: CaseIterable, Equatable {
    case unspecified;
    case base;
    case elevated;
    
    @available(iOS 13.0, *)
    var actualValue: UIUserInterfaceLevel {
      switch self {
        case .unspecified: return .unspecified;
        case .base       : return .base;
        case .elevated   : return .elevated;
      };
    };
    
    @available(iOS 13.0, *)
    init?(from interfaceLevel: UIUserInterfaceLevel) {
      let match = Self.allCases.first {
        $0.actualValue == interfaceLevel;
      };
      
      guard let match = match else { return nil };
      self = match;
    };
  };
  
  // Mirrors: `UIUserInterfaceActiveAppearance`
  public enum UserInterfaceActiveAppearance: CaseIterable, Equatable {
    case unspecified;
    case inactive;
    case active;
    
    @available(iOS 14.0, *)
    var actualValue: UIUserInterfaceActiveAppearance {
      switch self {
        case .unspecified: return .unspecified;
        case .inactive   : return .inactive;
        case .active     : return .active;
      };
    };
    
    @available(iOS 14.0, *)
    init?(from activeAppearance: UIUserInterfaceActiveAppearance) {
      let match = Self.allCases.first {
        $0.actualValue == activeAppearance;
      };
      
      guard let match = match else { return nil };
      self = match;
    };
  };
  
  // MARK: - Enum Values
  // -------------------
  
  case frameRect(
    of: FrameRectValue,
    valueForKey: KeyPath<CGRect, CGFloat>,
    condition: NumericLogicalExpression<CGFloat>
  );

  case size(
    of: SizeValue,
    valueForKey: KeyPath<CGSize, CGFloat>,
    condition: NumericLogicalExpression<CGFloat>
  );

  case safeAreaInsets(
    valueForKey: KeyPath<UIEdgeInsets, CGFloat>,
    condition: NumericLogicalExpression<CGFloat>
  );

  case deviceIdiom(is: UIUserInterfaceIdiom);

  case deviceOrientation(is: UIDeviceOrientation);

  case horizontalSizeClass(is: UIUserInterfaceSizeClass);

  case verticalSizeClass(is: UIUserInterfaceSizeClass);

  case interfaceStyle(is: UserInterfaceStyle);

  case interfaceLevel(is: UserInterfaceLevel);
  
  case interfaceOrientation(is: UIInterfaceOrientation);

  case activeAppearance(is: UserInterfaceActiveAppearance);

  case layoutDirection(is: UITraitEnvironmentLayoutDirection);

  case isFlagTrue(forKey: KeyPath<EvaluableConditionContext, Bool>);

  case deviceFlags(forKey: KeyPath<UIDevice, Bool>);

  case deviceString(
    forKey: KeyPath<UIDevice, String>,
    mode: StringComparisonMode,
    isCaseSensitive: Bool,
    stringValue: String
  );

  case customFlag(Bool);

  case negate(Self);

  case ifAnyAreTrue([Self]);

  case ifAllAreTrue([Self]);

  // MARK: - Functions
  // -----------------
  
  public func evaluate(
    usingContext context: EvaluableConditionContext
  ) -> Bool {
  
    switch self {
      case let .frameRect(rectValue, key, condition):
        return rectValue.evaluate(
          usingContext: context,
          forKey: key,
          condition: condition
        );

      case let .size(sizeValue, key, condition):
        return sizeValue.evaluate(
          usingContext: context,
          forKey: key,
          condition: condition
        );

      case let .safeAreaInsets(key, condition):
        let safeArea = context.safeAreaInsets ?? .zero;
        return condition.evaluate(forValue: safeArea[keyPath: key]);

      case let .deviceIdiom(value):
        return value == context.deviceUserInterfaceIdiom;

      case let .deviceOrientation(value):
        return value == context.deviceOrientation;

      case let .horizontalSizeClass(value):
        return value == context.horizontalSizeClass;

      case let .verticalSizeClass(value):
        return value == context.verticalSizeClass;

      case let .interfaceStyle(value):
        return value == context.interfaceStyle;

      case let .interfaceLevel(value):
        return value == context.interfaceLevel;
        
      case let .interfaceOrientation(value):
        return value == context.interfaceOrientation;

      case let .activeAppearance(value):
        return value == context.activeAppearance;

      case let .layoutDirection(value):
        return value == context.layoutDirection;

      case let .isFlagTrue(key):
        return context[keyPath: key];

      case let .deviceFlags(key):
        return UIDevice.current[keyPath: key];

      case let .deviceString(key, mode, isCaseSensitive, stringValue):
        let deviceString = UIDevice.current[keyPath: key];

        return mode.evaluate(
          a: deviceString,
          b: stringValue,
          isCaseSensitive: isCaseSensitive
        );

      case let .customFlag(flag):
        return flag;

      case let .negate(condition):
        return !condition.evaluate(usingContext: context);

      case let .ifAnyAreTrue(conditions):
        let result = conditions.first {
          $0.evaluate(usingContext: context);
        };

        return result != nil;

      case let .ifAllAreTrue(conditions):
        return conditions.allSatisfy {
          $0.evaluate(usingContext: context);
        };
    };
  };
};

