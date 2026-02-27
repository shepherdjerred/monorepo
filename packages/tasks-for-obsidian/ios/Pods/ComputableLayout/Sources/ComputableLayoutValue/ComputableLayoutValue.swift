//
//  ComputableLayoutValue.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 6/8/23.
//

import UIKit
import DGSwiftUtilities

public struct ComputableLayoutValue: Equatable {
  
  public let mode: ComputableLayoutValueMode;
  
  public let offsetValue: ComputableLayoutValueMode?;
  public let offsetOperation: NumericOperation?;

  public let minValue: ComputableLayoutValueMode?;
  public let maxValue: ComputableLayoutValueMode?;
  
  // MARK: - Init
  // ------------
  
  public init(
    mode: ComputableLayoutValueMode,
    offsetValue: ComputableLayoutValueMode? = nil,
    offsetOperation: NumericOperation? = nil,
    minValue: ComputableLayoutValueMode? = nil,
    maxValue: ComputableLayoutValueMode? = nil
  ) {
    self.mode = mode;
    
    self.offsetValue = offsetValue;
    self.offsetOperation = offsetOperation;
    self.minValue = minValue;
    self.maxValue = maxValue;
  };
  
  // MARK: - Intermediate Functions
  // ------------------------------
  
  public func applyOffsets(
    usingLayoutValueContext context: ComputableLayoutValueContext,
    toValue value: CGFloat
  ) -> CGFloat? {
    guard let offsetValue = self.offsetValue else { return value };
    
    let computedOffsetValue = offsetValue.compute(
      usingLayoutValueContext: context,
      preferredSizeKey: nil
    );
    
    guard let computedOffsetValue = computedOffsetValue else { return value };
    
    let computableOffset = ComputableLayoutOffset(
      offset: computedOffsetValue,
      offsetOperation: self.offsetOperation ?? .add
    );
    
    return computableOffset.compute(withValue: value, isValueOnRHS: true);
  };
  
  public func clampValue(
    usingLayoutValueContext context: ComputableLayoutValueContext,
    forValue value: CGFloat
  ) -> CGFloat? {
  
    let computedMinValue = self.minValue?.compute(
      usingLayoutValueContext: context,
      preferredSizeKey: nil
    );
      
    let computedMaxValue = self.maxValue?.compute(
      usingLayoutValueContext: context,
      preferredSizeKey: nil
    );
 
    let clamped = value.clamped(min: computedMinValue, max: computedMaxValue);
    
    return clamped;
  };
  
  public func computeRawValue(
    usingLayoutValueContext context: ComputableLayoutValueContext,
    preferredSizeKey: KeyPath<CGSize, CGFloat>?
  ) -> CGFloat? {
  
    return self.mode.compute(
      usingLayoutValueContext: context,
      preferredSizeKey: preferredSizeKey
    );
  };
  
  // MARK: - User-Invoked Functions
  // ------------------------------
  
  public func computeValue(
    usingLayoutValueContext context: ComputableLayoutValueContext,
    preferredSizeKey: KeyPath<CGSize, CGFloat>?
  ) -> CGFloat? {
  
    let computedValueRaw = self.computeRawValue(
      usingLayoutValueContext: context,
      preferredSizeKey: preferredSizeKey
    );
    
    let computedValueWithOffsets = self.applyOffsets(
      usingLayoutValueContext: context,
      toValue: computedValueRaw ?? 0
    );
    
    return self.clampValue(
      usingLayoutValueContext: context,
      forValue: computedValueWithOffsets ?? 0
    );
  };
};
