//
//  InterpolationEasing.swift
//  
//
//  Created by Dominic Go on 7/22/24.
//

import Foundation

extension InterpolationEasing: CaseIterable {

  public static var allCases: [InterpolationEasing] = [
    .linear,
    .easeInSine,
    .easeOutSine,
    .easeInOutSine,
    .easeInQuad,
    .easeOutQuad,
    .easeInOutQuad,
    .easeInCubic,
    .easeOutCubic,
    .easeInOutCubic,
    .easeInQuart,
    .easeOutQuart,
    .easeInOutQuart,
    .easeInQuint,
    .easeOutQuint,
    .easeInOutQuint,
    .easeInExpo,
    .easeOutExpo,
    .easeInOutExpo,
  ];
};
