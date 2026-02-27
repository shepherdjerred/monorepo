//
//  StaticAlias.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 6/21/23.
//

import UIKit

public extension CACornerMask {

  static let uniqueElements: [Self] = [
    .layerMinXMinYCorner,
    .layerMaxXMinYCorner,
    .layerMinXMaxYCorner,
    .layerMaxXMaxYCorner,
  ];

  static let allCorners: Self = [
    .layerMinXMinYCorner,
    .layerMaxXMinYCorner,
    .layerMinXMaxYCorner,
    .layerMaxXMaxYCorner,
  ];

  static let topCorners: Self = [
    .layerMinXMinYCorner,
    .layerMaxXMinYCorner,
  ];
  
  static let bottomCorners: Self = [
    .layerMinXMaxYCorner,
    .layerMaxXMaxYCorner,
  ];
  
  static let leftCorners: Self = [
    .layerMinXMinYCorner,
    .layerMinXMaxYCorner,
  ];
  
  static let rightCorners: Self = [
    .layerMaxXMinYCorner,
    .layerMaxXMaxYCorner,
  ];
};
