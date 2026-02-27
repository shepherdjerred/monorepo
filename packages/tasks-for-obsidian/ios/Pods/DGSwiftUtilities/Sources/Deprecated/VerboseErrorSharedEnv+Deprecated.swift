//
//  VerboseErrorSharedEnv+Deprecated.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import Foundation


public extension VerboseErrorSharedEnv {

  @available(*, deprecated, renamed: "overrideShouldLogFilePath")
  static var shouldLogFileMetadata: Bool? {
    Self.overrideShouldLogFilePath;
  };
  
  @available(*, deprecated, renamed: "overrideShouldLogFilePath")
  static var shouldLogFilePath: Bool? {
    Self.overrideShouldLogFilePath;
  };
};
