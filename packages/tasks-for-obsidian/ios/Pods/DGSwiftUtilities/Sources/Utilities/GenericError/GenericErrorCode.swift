//
//  GenericErrorCode.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 10/18/23.
//

import Foundation


public enum GenericErrorCode: String, ErrorCode, GenericErrorCodes {
  case unexpectedNilValue;
  case guardCheckFailed;
  case invalidValue;
  case indexOutOfBounds;
  case typeCastFailed;
  case illegalState;
  case runtimeError;
  case invalidArgument;
  case unknownError;
  
  
  public var description: String? { nil };
};



