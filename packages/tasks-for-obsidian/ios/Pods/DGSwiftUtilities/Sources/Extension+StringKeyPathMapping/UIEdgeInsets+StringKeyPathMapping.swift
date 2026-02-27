//
//  UIEdgeInsets+StringKeyPathMapping.swift
//  
//
//  Created by Dominic Go on 12/27/23.
//

import UIKit

extension UIEdgeInsets: StringKeyPathMapping {

  public static var partialKeyPathMap: Dictionary<String, PartialKeyPath<Self>> = [
    "top": \.top,
    "left": \.left,
    "bottom": \.bottom,
    "right": \.right,
  ];
};
