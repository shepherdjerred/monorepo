//
//  EvaluableConditionSizeValue.swift
//  
//
//  Created by Dominic Go on 12/19/23.
//

import Foundation
import DGSwiftUtilities

public enum EvaluableConditionSizeValue: Equatable {
  case window;
  case screen;
  case statusBar;
  case targetView;
  
  case custom(CGSize);
  
  func evaluate(
    usingContext context: EvaluableConditionContext,
    forKey key: KeyPath<CGSize, CGFloat>,
    condition: NumericLogicalExpression<CGFloat>
  ) -> Bool {
  
    let size: CGSize = {
      switch self {
        case .window:
          return context.windowFrame?.size ?? .zero;
          
        case .screen:
          return context.screenBounds.size;
        
        case .targetView:
          return context.targetViewFrame?.size ?? .zero;
          
        case .statusBar:
          return context.statusBarFrame?.size ?? .zero;
          
        case let .custom(size):
          return size;
      };
    }();
    
    let value = size[keyPath: key];
    return condition.evaluate(forValue: value);
  };
};
