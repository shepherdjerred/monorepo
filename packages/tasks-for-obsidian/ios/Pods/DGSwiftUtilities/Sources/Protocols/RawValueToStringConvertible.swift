//
//  RawValueToStringConvertible.swift
//  
//
//  Created by Dominic Go on 12/31/24.
//

import Foundation

public protocol RawValueToStringConvertible:
  // manual conformance needed
  StringMappedRawRepresentable,
  CaseIterable,
  // auto conformance created
  EnumCaseStringRepresentable,
  InitializableFromString,
  CustomStringConvertible
{
  // no-op
};

// MARK: - RawValueToStringConvertible+InitializableFromString (Default)
//----------------------------------------------------------------------

public extension RawValueToStringConvertible {

  init(fromString string: String) throws {
    guard let rawValue = Self.getRawValue(forCaseName: string),
          let match: Self = .init(rawValue: rawValue)
    else {
      throw GenericError(
        errorCode: .invalidArgument,
        description: "Invalid string value",
        extraDebugValues: [
          "string": string,
          "type": String(describing: Self.self),
        ]
      );
    };
    
    self = match;
  };
};

// MARK: - RawValueToStringConvertible+RawValueToStringConvertible
// ---------------------------------------------------------------

public extension RawValueToStringConvertible {
  
  var description: String {
    self.caseString;
  };
};
