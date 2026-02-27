//
//  LineDashPattern.swift
//  
//
//  Created by Dominic Go on 11/26/24.
//

import Foundation
import QuartzCore


public enum LineDashPattern: Equatable {

  case noPattern;
  
  case custom(pattern: [CGFloat]);
  
  /// Example: `.uniform(dashLength: 3, spacing: 2)`
  /// Result: `***  ***  ***  ***`
  ///
  case uniform(dashLength: CGFloat, spacing: CGFloat);
  
  /// Example:
  /// ```
  /// .alternating(
  ///   dashLengthOdd : 6, spacingOdd : 3,
  ///   dashLengthEven: 3, spacingEven: 3
  /// )
  /// ```
  /// Result: `******   ***   ******   ***`
  ///
  case alternating(
    dashLengthOdd: CGFloat,
    spacingOdd: CGFloat,
    dashLengthEven: CGFloat,
    spacingEven: CGFloat
  );
  
  public var values: [CGFloat]? {
    switch self {
      case .noPattern:
        return nil;
    
      case let .custom(pattern):
        return pattern;
        
      case let .uniform(dashLength, spacing):
        return [dashLength, spacing];
      
      case let .alternating(dashLengthOdd, spacingOdd, dashLengthEven, spacingEven):
        return [dashLengthOdd, spacingOdd, dashLengthEven, spacingEven];
    };
  };
  
  public var valuesObjc: [NSNumber]? {
    self.values?.map {
      .init(floatLiteral: $0);
    };
  };
  
  public func apply(toShape shapeLayer: CAShapeLayer){
    shapeLayer.lineDashPattern = self.valuesObjc;
  };
};

// MARK: - LineDashPattern+StaticAlias
// -----------------------------------

public extension LineDashPattern {
  
  static func alternatingWithUniformSpacing(
    dashLengthOdd: CGFloat,
    dashLengthEven: CGFloat,
    spacing: CGFloat
  ) -> Self {
    .alternating(
      dashLengthOdd: dashLengthOdd,
      spacingOdd: spacing,
      dashLengthEven: dashLengthEven,
      spacingEven: spacing
    );
  };
};
