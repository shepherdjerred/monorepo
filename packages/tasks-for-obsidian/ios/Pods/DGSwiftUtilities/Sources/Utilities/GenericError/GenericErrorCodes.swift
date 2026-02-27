//
//  DefaultErrorCodes.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 10/18/23.
//

import Foundation

public protocol GenericErrorCodes {
  
  static var unexpectedNilValue: Self { get };
  
  static var guardCheckFailed: Self { get };
  
  static var invalidValue: Self { get };
  
  static var indexOutOfBounds: Self { get };
  
  static var typeCastFailed: Self { get };
  
  static var illegalState: Self { get };
  
  static var runtimeError: Self { get };
  
  static var invalidArgument: Self { get };
  
  static var unknownError: Self { get };
  
};
