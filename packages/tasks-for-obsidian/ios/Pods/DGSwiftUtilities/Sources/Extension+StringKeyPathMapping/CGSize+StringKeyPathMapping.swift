//
//  CGSize+StringKeyPathMapping.swift
//  
//
//  Created by Dominic Go on 12/27/23.
//

import Foundation


extension CGSize: StringKeyPathMapping {
  public static var partialKeyPathMap: Dictionary<String, PartialKeyPath<CGSize>> = [
    "width": \.width,
    "height": \.height,
  ];
};
