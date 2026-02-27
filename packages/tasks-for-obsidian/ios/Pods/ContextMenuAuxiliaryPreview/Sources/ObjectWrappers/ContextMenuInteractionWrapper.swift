//
//  ContextMenuInteractionWrapper.swift
//  
//
//  Created by Dominic Go on 11/6/23.
//

import UIKit
import DGSwiftUtilities


public class ContextMenuInteractionWrapper: ObjectWrapper<
  UIContextMenuInteraction,
  ContextMenuInteractionWrapper.EncodedString
> {
  
  public enum EncodedString: String, HashedStringDecodable {
    case presentMenuAtLocation;
    
    public var encodedString: String {
      switch self {
      
        /// Instance method exists in 17.1, 16.3, 15.2.1, 14.4, 13.1.3
        case .presentMenuAtLocation:
          // _presentMenuAtLocation:
          return "X3ByZXNlbnRNZW51QXRMb2NhdGlvbjo=";
      };
    };
  };
  
  public func presentMenuAtLocation(point: CGPoint) throws {
    try self.performSelector(
      usingEncodedString: .presentMenuAtLocation,
      withArg1: point
    )
  };
};

