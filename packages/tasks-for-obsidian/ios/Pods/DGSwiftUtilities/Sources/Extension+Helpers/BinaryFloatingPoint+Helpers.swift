//
//  File 2.swift
//  
//
//  Created by Dominic Go on 7/10/24.
//

import Foundation


public extension BinaryFloatingPoint {
  
  var asWholeNumberExact: Int? {
    Int(exactly: self)
  };

  var isWholeNumber: Bool {
    self.asWholeNumberExact != nil;
  };
  
  /// Rounds the double to decimal places value
  func roundToPlaces(_ places: Int) -> Self {
    let divisorRaw = pow(10.0, .init(places));
    let divisor = Self(divisorRaw);
    
    return (self * divisor).rounded() / divisor;
  };
  
  func cutOffDecimalsAfter(_ places:Int) -> Self {
    let divisorRaw = pow(10.0, .init(places));
    let divisor = Self(divisorRaw);
    
    return (self * divisor).rounded(.towardZero) / divisor;
  };
  
  /// - Returns: `true` if the absolute difference between the two values is
  ///   within the tolerance, otherwise `false`.
  ///
  func isApproximatelyEqual(
    toOtherValue otherValue: Self,
    withTolerance tolerance: Self
  ) -> Bool {
   let delta = abs(self - otherValue);
   return delta <= tolerance;
  };
  
  func isApproximatelyEqual(
    toOtherValue otherValue: Self,
    numberOfPlaces: Int
  ) -> Bool {
    let lhs = self.cutOffDecimalsAfter(numberOfPlaces);
    let rhs = otherValue.cutOffDecimalsAfter(numberOfPlaces);
    return lhs == rhs;
  };
  
  func isApproximatelyEqual(
    toOtherValue otherValue: Self,
    withRangeDelta rangeDelta: Self
  ) -> Bool {
    let rangeMin = otherValue - rangeDelta;
    let rangeMax = otherValue + rangeDelta;
    
    let isWithinMinRange = self >= rangeMin;
    let isWithinMaxRange = self <= rangeMax;
    
    return isWithinMinRange && isWithinMaxRange;
  };
  
  static func percent<T: BinaryInteger>(index: T, count: T) -> Self {
    .init(index + 1) / .init(count);
  };
};
