//
//  File.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import Foundation


public struct GenericErrorMetadata: ErrorMetadata {
  public static var domain: String? = nil;
  public static var parentType: String? = nil;
};

public typealias GenericError =
  VerboseError<GenericErrorMetadata, GenericErrorCode>;
