//
//  CompositeInterpolatableMappingProvider.swift
//  
//
//  Created by Dominic Go on 7/23/24.
//

import Foundation

public enum CompositeInterpolatableMappingProvider<T, U> {
   
  case returnOnly(() -> U);
  
  case rangeIndex((
    _ rangeIndex: Int
  ) -> U);
  
  case interpolatorType((
    _ interpolatorType: RangeInterpolationMode
  ) -> U);
  
  case rangeIndexAndInterpolatorType((
    _ rangeIndex: Int,
    _ interpolatorType: RangeInterpolationMode
  ) -> U);

  case inputRange((
    _ inputValueStart: CGFloat,
    _ inputValueEnd: CGFloat
  ) -> U);
  
  case outputRange((
    _ outputValueStart: T,
    _ outputValueEnd: T
  ) -> U);
  
  case inputAndOutputRange((
    _ inputValueStart: CGFloat,
    _ inputValueEnd: CGFloat,
    _ outputValueStart: T,
    _ outputValueEnd: T
  ) -> U);
  
  case verbose((
    _ rangeIndex: Int,
    _ interpolatorType: RangeInterpolationMode,
    _ inputValueStart: CGFloat,
    _ inputValueEnd: CGFloat,
    _ outputValueStart: T,
    _ outputValueEnd: T
  ) -> U);
     
  public func invoke(
    rangeIndex: Int,
    interpolatorType: RangeInterpolationMode,
    inputValueStart: CGFloat,
    inputValueEnd: CGFloat,
    outputValueStart: T,
    outputValueEnd: T
  ) -> U {
    
    switch self {
      case let .returnOnly(providerBlock):
        return providerBlock();
      
      case let .rangeIndex(providerBlock):
        return providerBlock(rangeIndex);
  
      case let .interpolatorType(providerBlock):
        return providerBlock(interpolatorType);
        
      case let .rangeIndexAndInterpolatorType(providerBlock):
        return providerBlock(rangeIndex, interpolatorType);

      case let .inputRange(providerBlock):
        return providerBlock(
          inputValueStart,
          inputValueEnd
        );
      
      case let .outputRange(providerBlock):
        return providerBlock(
          outputValueStart,
          outputValueEnd
        );
        
      case let .inputAndOutputRange(providerBlock):
        return providerBlock(
          inputValueStart,
          inputValueEnd,
          outputValueStart,
          outputValueEnd
        );
      
      case let .verbose(providerBlock):
        return providerBlock(
          rangeIndex,
          interpolatorType,
          inputValueStart,
          inputValueEnd,
          outputValueStart,
          outputValueEnd
        );
    };
  };
};
