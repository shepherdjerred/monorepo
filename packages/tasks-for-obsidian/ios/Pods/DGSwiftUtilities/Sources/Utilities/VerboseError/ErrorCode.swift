//
//  ErrorCode.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 10/18/23.
//

import Foundation

public protocol ErrorCode: RawRepresentable<String>  {
  var description: String? { get };
};


