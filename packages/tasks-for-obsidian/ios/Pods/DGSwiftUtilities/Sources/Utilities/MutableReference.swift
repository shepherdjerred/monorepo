//
//  MutableReference.swift
//  
//
//  Created by Dominic Go on 12/4/24.
//

import Foundation

public protocol MutableReference {
  
  mutating func mutableRef() -> UnsafeMutablePointer<Self>;
};

// MARK: - MutableCopy+Default
// ---------------------------

public extension MutableReference {
  
  /// Example usage:
  /// ```
  /// var transform: Transform3D = .init();
  ///
  /// transform.mutableRef()
  ///   .withTranslateX(90)
  ///   .withScaleY(3);
  /// ```
  mutating func mutableRef() -> UnsafeMutablePointer<Self> {
    withUnsafeMutablePointer(to: &self) {
      $0;
    };
  };
};
