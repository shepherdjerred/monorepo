//
//  InitializableFromDictionary.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 12/22/23.
//

import Foundation


public protocol InitializableFromDictionary {
  
  init(fromDict dict: Dictionary<String, Any>) throws;
};
