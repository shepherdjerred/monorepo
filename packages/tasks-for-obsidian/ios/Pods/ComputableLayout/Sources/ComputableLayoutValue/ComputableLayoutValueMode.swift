//
//  ComputableLayoutValueMode.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 6/8/23.
//

import UIKit

public indirect enum ComputableLayoutValueMode: Equatable {

  case stretch;
  
  case constant(_: CGFloat);
  
  case percent(
    relativeTo: ComputableLayoutValuePercentTarget = .targetSize,
    percentValue: Double
  );
  
  case safeAreaInsets(
    insetKey: KeyPath<UIEdgeInsets, CGFloat>
  );
  
  case keyboardScreenRect(
    rectKey: KeyPath<CGRect, CGFloat>
  );
  
  case keyboardRelativeSize(
    sizeKey: KeyPath<CGSize, CGFloat>
  );
  
  case multipleValues(_ values: [Self]);
  
  case conditionalLayoutValue(
    condition: ComputableLayoutValueEvaluableCondition,
    trueValue: Self?,
    falseValue: Self? = nil
  );
  
  case conditionalValue(
    condition: EvaluableCondition,
    trueValue: Self?,
    falseValue: Self? = nil
  );

  // MARK: Functions
  // ---------------
  
  public func compute(
    usingLayoutValueContext context: ComputableLayoutValueContext,
    preferredSizeKey: KeyPath<CGSize, CGFloat>? = nil
  ) -> CGFloat? {
  
    switch self {
      case .stretch:
        guard let preferredSizeKey = preferredSizeKey else { return nil };
        return context.targetSize[keyPath: preferredSizeKey];
        
      case let .constant(constantValue):
        return constantValue;
        
      case let .percent(relativeToValue, percentValue):
        let targetValue = relativeToValue.getValue(
          layoutValueContext: context,
          preferredSizeKey: preferredSizeKey
        );
        
        guard let targetValue = targetValue else { return nil };
        return targetValue * percentValue;
        
      case let .safeAreaInsets(insetKey):
        return context.safeAreaInsets?[keyPath: insetKey];
        
      case let .keyboardScreenRect(rectKey):
        return context.keyboardScreenRect?[keyPath: rectKey];
        
      case let .keyboardRelativeSize(sizeKey):
        return context.keyboardRelativeSize?[keyPath: sizeKey];
        
      case let .multipleValues(computableValues):
        return computableValues.reduce(0) {
          let computedValue = $1.compute(
            usingLayoutValueContext: context,
            preferredSizeKey: preferredSizeKey
          );
          
          return $0 + (computedValue ?? 0);
        };
        
      case let .conditionalLayoutValue(condition, trueValue, falseValue):
        let value = condition.evaluate(usingContext: context)
          ? trueValue
          : falseValue;
          
        return value?.compute(
          usingLayoutValueContext: context,
          preferredSizeKey: preferredSizeKey
        );
        
      case let .conditionalValue(condition, trueValue, falseValue):
        let value = condition.evaluate(usingContext: context.evaluableConditionContext)
          ? trueValue
          : falseValue;
        
        return value?.compute(
          usingLayoutValueContext: context,
          preferredSizeKey: preferredSizeKey
        );
    };
  };
};
