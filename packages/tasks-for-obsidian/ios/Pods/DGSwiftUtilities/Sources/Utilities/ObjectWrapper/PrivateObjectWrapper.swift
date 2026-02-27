//
//  ObjectWrapperBase.swift
//  
//
//  Created by Dominic Go on 9/18/23.
//

import Foundation


open class PrivateObjectWrapper<
  WrapperType: AnyObject,
  EncodedString: PrivateObjectWrappingEncodedString
>: ObjectWrapper<
  WrapperType,
  EncodedString
> {

  // MARK: - Class Properties
  // ------------------------

  public static var className: String? {
    EncodedString.className.decodedString;
  };
  
  public static var classType: AnyClass? {
    guard let className = Self.className else { return nil };
    return NSClassFromString(className);
  };
  
  // MARK: - Class Methods
  // ---------------------
  
  public static func createInstance() -> NSObject? {
    guard let classType = Self.classType,
          let classTypeErased = classType as? NSObject.Type
    else {
      return nil;
    };
    
    return classTypeErased.init();
  };
  
  // MARK: - Init
  // ------------

  public override init?(
    objectToWrap sourceObject: AnyObject,
    shouldRetainObject: Bool = false
  ){
    
    guard let sourceObject = sourceObject as? NSObject,
          let className = Self.className,
          sourceObject.className == className
    else { return nil };
    
    super.init(
      objectToWrap: sourceObject,
      shouldRetainObject: shouldRetainObject
    );
  };
  
  public convenience init?(){
    guard let instance = Self.createInstance() else {
      return nil;
    };
    
    self.init(objectToWrap: instance, shouldRetainObject: true);
  };
};
