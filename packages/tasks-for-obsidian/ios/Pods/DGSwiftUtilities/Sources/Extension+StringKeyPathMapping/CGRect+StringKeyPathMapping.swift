//
//  CGRect+StringKeyPathMapping.swift
//  
//
//  Created by Dominic Go on 12/27/23.
//

import Foundation

extension CGRect: StringKeyPathMapping {
  public static var partialKeyPathMap: Dictionary<String, PartialKeyPath<Self>> = [
    "origin": \.origin,
    "size": \.size,
    
    "minX": \.minX, 
    "midX": \.midX,
    "maxX": \.maxX,
    "minY": \.minY,
    "midY": \.midY,
    "maxY": \.maxY,
    "width": \.width,
    "height": \.height,
    "standardized": \.standardized,
    "isEmpty": \.isEmpty,
    "isNull": \.isNull,
    "isInfinite": \.isInfinite,
    "integral": \.integral,
    "dictionaryRepresentation": \.dictionaryRepresentation,
  ];
};
