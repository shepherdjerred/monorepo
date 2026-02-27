//
//  File.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import Foundation

public class Helpers {

  public static func unwrapAndSetProperty<O: AnyObject, T>(
    forObject object: O?,
    forPropertyKey propertyKey: WritableKeyPath<O, T>,
    withValue value: T?
  ) {
    guard var object = object,
          let value = value
    else { return };
    
    object[keyPath: propertyKey] = value;
  };
  
  public static func unwrapAndSetProperty<O, T>(
    forValue value: inout O?,
    forPropertyKey propertyKey: WritableKeyPath<O, T>,
    withValue newValue: T?
  ) {
    guard var value = value,
          let newValue = newValue
    else { return };
    
    value[keyPath: propertyKey] = newValue;
  };
};
