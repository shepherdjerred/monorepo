//
//  Singleton.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 10/4/23.
//


import Foundation


public protocol Singleton: AnyObject {
  static var shared: Self { get };
};

public protocol InitializableSingleton: Singleton {
  
  init();
};
