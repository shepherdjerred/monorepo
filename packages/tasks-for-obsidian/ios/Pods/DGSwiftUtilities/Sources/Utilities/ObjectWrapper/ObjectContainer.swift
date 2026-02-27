//
//  ObjectWrapper.swift
//  
//
//  Created by Dominic Go on 9/17/23.
//

import Foundation


open class ObjectContainer<T> {
  
  private let shouldRetainObject: Bool;

  private var retainedObject: AnyObject?;
  @objc private weak var unretainedObject: AnyObject?;
  
  public var objectRaw: AnyObject? {
    self.shouldRetainObject
      ? self.retainedObject
      : unretainedObject;
  };
  
  public var object: T? {
    self.objectRaw as? T;
  };
  
  public init(
    objectToWrap object: AnyObject?,
    shouldRetainObject: Bool
  ) {
    
    if shouldRetainObject {
      self.retainedObject = object;
      
    } else {
      self.unretainedObject = object;
    };
    
    self.shouldRetainObject = shouldRetainObject;
  };
};
