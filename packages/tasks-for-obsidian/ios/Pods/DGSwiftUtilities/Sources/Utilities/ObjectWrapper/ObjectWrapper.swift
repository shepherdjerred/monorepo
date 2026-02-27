//
//  ObjectWrapper.swift
//  
//
//  Created by Dominic Go on 11/6/23.
//

import Foundation


open class ObjectWrapper<
  WrapperType: AnyObject,
  EncodedString: HashedStringDecodable
> {

  // MARK: - Properties
  // ------------------

  public var objectWrapper: ObjectContainer<WrapperType>;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var wrappedObject: WrapperType? {
    self.objectWrapper.object;
  };
  
  // MARK: - Init
  // ------------
  
  public init?(
    objectToWrap sourceObject: AnyObject,
    shouldRetainObject: Bool = false
  ){
    
    guard let sourceObject = sourceObject as? NSObject else { return nil };
  
    self.objectWrapper = .init(
      objectToWrap: sourceObject,
      shouldRetainObject: shouldRetainObject
    );
  };
  
  // MARK: - Methods
  // ---------------
  
  @discardableResult
  public func performSelector<T>(
    usingEncodedString encodedString: EncodedString,
    withArg1 arg1: Any? = nil,
    withArg2 arg2: Any? = nil,
    type: T.Type = Any.self,
    shouldRetainValue: Bool = false
  ) throws -> T? {
  
    guard let wrappedObject = self.wrappedObject else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Could not get wrapped object"
      );
    };
    
    return try ObjectWrapperHelpers.performSelector(
      forObject: wrappedObject,
      selectorFromHashedString: encodedString,
      withArg1: arg1,
      withArg2: arg2,
      type: type,
      shouldRetainValue: shouldRetainValue
    );
  };
  
  public func debugPrintWrappedObject(){
    #if DEBUG
    print(self.wrappedObject.debugDescription);
    #endif
  };
  
  // MARK: Class Methods
  // -------------------
  
  @discardableResult
  public func getValue<T>(
    forHashedString encodedString: EncodedString,
    type: T.Type = Any.self
  ) throws -> T? {
    guard let wrappedObject = self.wrappedObject as? NSObject,
          let key = encodedString.decodedString
    else { return nil };
    
    let value = wrappedObject.value(forKey: key);
    guard let value = value else {
      return nil;
    };
    
    return value as? T;
  };
  
  public func setValue<T>(
    forHashedString encodedString: EncodedString,
    value: T?
  ) throws {
    guard let wrappedObject = self.wrappedObject as? NSObject,
          let key = encodedString.decodedString
    else { return };
    
    wrappedObject.setValue(value, forKey: key);
  };
};

// MARK: - Class Methods
// ---------------------

extension ObjectWrapper {

  @discardableResult
  public static func performSelector<T>(
    usingHashedString encodedString: EncodedString,
    forObject object: AnyObject,
    withArg1 arg1: Any? = nil,
    withArg2 arg2: Any? = nil,
    type: T.Type = Any.self,
    shouldRetainValue: Bool = false
  ) throws -> T? {
  
    return try ObjectWrapperHelpers.performSelector(
      forObject: object,
      selectorFromHashedString: encodedString,
      withArg1: arg1,
      withArg2: arg2,
      type: type,
      shouldRetainValue: shouldRetainValue
    );
  };
};
