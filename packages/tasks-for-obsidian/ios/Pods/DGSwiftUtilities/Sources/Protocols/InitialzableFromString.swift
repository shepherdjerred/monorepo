//
//  InitializableFromString.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 12/31/23.
//

import Foundation

// TODO: Move to `DGSwiftUtilities`
public protocol InitializableFromString {
  
  init(fromString string: String) throws;
};

extension RawRepresentable where RawValue == String {
  
  public init(fromString string: String) throws {
    guard let value = Self.init(rawValue: string) else {
      throw GenericError(
        errorCode: .invalidArgument,
        description: "Invalid string value",
        extraDebugValues: [
          "string": string
        ]
      );
    };
    
    self = value;
  };
};
