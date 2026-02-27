//
//  ComputableLayoutValue+StaticInit.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 6/19/23.
//

import UIKit
import DGSwiftUtilities

public extension ComputableLayoutValue {
 
  static let stretch: Self = .init(mode: .stretch);
  
  static func stretch(
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode:. stretch,
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
  
  static func constant(_ constantValue: CGFloat) -> Self {
    return .init(mode: .constant(constantValue))
  };
  
  static func percent(
    relativeTo: ComputableLayoutValuePercentTarget = .targetSize,
    percentValue: Double,
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode: .percent(
        relativeTo: relativeTo,
        percentValue: percentValue
      ),
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
  
  static func safeAreaInsets(
    insetKey: KeyPath<UIEdgeInsets, CGFloat>,
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode: .safeAreaInsets(insetKey: insetKey),
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
  
  static func keyboardScreenRect(
    rectKey: KeyPath<CGRect, CGFloat>,
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode: .keyboardScreenRect(rectKey: rectKey),
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
  
  static func keyboardRelativeSize(
    sizeKey: KeyPath<CGSize, CGFloat>,
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode: .keyboardRelativeSize(sizeKey: sizeKey),
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
  
  static func multipleValues(
    _ values: [ComputableLayoutValueMode],
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode: .multipleValues(values),
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
  
  static func conditionalLayoutValue(
    condition: ComputableLayoutValueEvaluableCondition,
    trueValue: ComputableLayoutValueMode?,
    falseValue: ComputableLayoutValueMode? = nil,
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode: .conditionalLayoutValue(
        condition: condition,
        trueValue: trueValue,
        falseValue: falseValue
      ),
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
  
  static func conditionalValue(
    condition: EvaluableCondition,
    trueValue: ComputableLayoutValueMode?,
    falseValue: ComputableLayoutValueMode? = nil,
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) -> Self {
  
    return .init(
      mode: .conditionalValue(
        condition: condition,
        trueValue: trueValue,
        falseValue: falseValue
      ),
      offsetValue: offsetValue,
      offsetOperation: offsetOperation,
      minValue: minValue,
      maxValue: maxValue
    );
  };
};
