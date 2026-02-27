//
//  CompositeInterpolatableElements.swift
//  
//
//  Created by Dominic Go on 7/18/24.
//

import Foundation


public protocol CompositeInterpolatableElements: Hashable {
  
  var associatedAnyKeyPaths: [AnyKeyPath] { get };
};

public extension CompositeInterpolatableElements {
  
  func getAssociatedAnyKeyPaths<T>(
    forType targetType: T
  ) -> [AnyKeyPath] {
    
    self.associatedAnyKeyPaths.filter {
      $0.rootTypeAsType is T;
    };
  };
  
  func getAssociatedPartialKeyPaths<T>(
    forType targetType: T.Type
  ) -> [PartialKeyPath<T>] {
  
    self.associatedAnyKeyPaths.compactMap {
      $0 as? PartialKeyPath<T>;
    };
  };
};
