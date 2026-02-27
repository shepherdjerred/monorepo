//
//  ComputableLayoutValueContext+StringKeyPathMapping.swift
//
//
//  Created by Dominic Go on 12/28/23.
//

import Foundation
import DGSwiftUtilities


extension ComputableLayoutValueContext: StringKeyPathMapping {

  public static var partialKeyPathMap: Dictionary<String, PartialKeyPath<Self>> = [
    "evaluableConditionContext": \.evaluableConditionContext,
    "targetRect": \.targetRect,
    "windowSize": \.windowSize,
    "currentSize": \.currentSize,
    "safeAreaInsets": \.safeAreaInsets,
    "keyboardScreenRect": \.keyboardScreenRect,
    "keyboardRelativeSize": \.keyboardRelativeSize,
    "targetSize": \.targetSize,
    "screenSize": \.screenSize,
  ];
};
