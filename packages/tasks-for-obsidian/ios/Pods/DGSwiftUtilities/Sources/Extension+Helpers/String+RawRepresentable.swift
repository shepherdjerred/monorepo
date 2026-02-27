//
//  String+RawRepresentable.swift
//
//
//  Created by Dominic Go on 6/14/24.
//

import Foundation

extension String: RawRepresentable {
  public var rawValue: String {
    self;
  }
  
  public typealias RawValue = String;
  
  public init?(rawValue: String) {
    self = rawValue;
  }
};
