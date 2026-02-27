//
//  ValueInjectable.swift
//  
//
//  Created by Dominic Go on 6/14/24.
//

import Foundation


public protocol ValueInjectable: AnyObject {

  associatedtype Keys: RawRepresentable<String> = String;
  
  typealias InjectedValuesMap = Dictionary<String, Any?>;
  
  var injectedValues: InjectedValuesMap { get set };
};

