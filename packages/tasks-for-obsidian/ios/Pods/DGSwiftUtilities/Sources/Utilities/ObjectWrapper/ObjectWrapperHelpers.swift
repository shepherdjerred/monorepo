//
//  ObjectWrapperHelpers.swift
//  
//
//  Created by Dominic Go on 11/6/23.
//
import Foundation


public class ObjectWrapperHelpers {
  
  @discardableResult
  public static func performSelector<T>(
    forObject object: AnyObject,
    selector: Selector,
    withArg1 arg1: Any? = nil,
    withArg2 arg2: Any? = nil,
    type: T.Type = Any.self,
    shouldRetainValue: Bool = false
  ) -> T? {

    let selectorResult: Unmanaged<AnyObject>? = {
      if let arg1 = arg1 {
        return object.perform(selector, with: arg1);
      };
      
      if let arg1 = arg1,
         let arg2 = arg2 {
         
        return object.perform(selector, with: arg1, with: arg2);
      };
      
      return object.perform(selector)
    }();
    
    guard let selectorResult = selectorResult else { return nil };
    
    if T.self == Any.self || T.self == Void.self {
      return nil;
    };
    
    let rawValue = shouldRetainValue
      ? selectorResult.takeRetainedValue()
      : selectorResult.takeUnretainedValue();
        
    return rawValue as? T;
  };
  
  @discardableResult
  public static func performSelector<T>(
    forObject object: AnyObject,
    selectorFromHashedString hashedString: any HashedStringDecodable,
    withArg1 arg1: Any? = nil,
    withArg2 arg2: Any? = nil,
    type: T.Type = Any.self,
    shouldRetainValue: Bool = false
  ) throws -> T? {
  
    guard let decodedString = hashedString.decodedString else {
      throw GenericError(
        errorCode: .guardCheckFailed,
        description: "Failed to decode string for HashedStringDecodable",
        extraDebugValues: [
          "objectName": (object as? NSObject)?.className ?? "N/A",
          "typeName": String(describing: hashedString.self),
          "rawValue": hashedString.rawValue,
          "encodedString": hashedString.encodedString,
        ]
      );
    };
    
    let selector = NSSelectorFromString(decodedString);
    
    guard object.responds(to: selector) else {
      throw GenericError(
        errorCode: .guardCheckFailed,
        description: "object does not respond to selector: \(decodedString)",
        extraDebugValues: [
          "objectName": (object as? NSObject)?.className ?? "N/A",
          "typeName": String(describing: hashedString.self),
          "rawValue": hashedString.rawValue,
          "encodedString": hashedString.encodedString,
          "decodedString": decodedString,
        ]
      );
    };
    
    return Self.performSelector(
      forObject: object,
      selector: selector,
      withArg1: arg1,
      withArg2: arg2,
      type: type,
      shouldRetainValue: shouldRetainValue
    );
  };
};
