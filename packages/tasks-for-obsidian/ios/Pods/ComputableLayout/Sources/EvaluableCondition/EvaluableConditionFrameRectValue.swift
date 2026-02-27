//
//  EvaluableConditionFrameRectValue.swift
//
//
//  Created by Dominic Go on 12/19/23.
//

import Foundation
import DGSwiftUtilities

public enum EvaluableConditionFrameRectValue: Equatable {
  case window;
  case targetView;
  case statusBar;
  
  case custom(CGRect);
  
  public func evaluate(
    usingContext context: EvaluableConditionContext,
    forKey key: KeyPath<CGRect, CGFloat>,
    condition: NumericLogicalExpression<CGFloat>
  ) -> Bool {
    let rect: CGRect = {
      switch self {
        case .window:
          return context.windowFrame ?? .zero;
          
        case .targetView:
          return context.targetViewFrame ?? .zero;
          
        case .statusBar:
          return context.statusBarFrame ?? .zero;
          
        case let .custom(rect):
          return rect;
      };
    }();
    
    let value = rect[keyPath: key];
    return condition.evaluate(forValue: value);
  };
};
