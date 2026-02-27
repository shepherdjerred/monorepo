//
//  CGPoint+StringKeyPathMapping.swift
//
//
//  Created by Dominic Go on 12/27/23.
//

import Foundation

extension CGPoint: StringKeyPathMapping {
  public static var partialKeyPathMap: Dictionary<String, PartialKeyPath<Self>> = [
    "x": \.x,
    "y": \.y
  ];
};
