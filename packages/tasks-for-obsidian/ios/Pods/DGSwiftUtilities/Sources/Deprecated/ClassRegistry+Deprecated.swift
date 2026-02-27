//
//  ClassRegistry+Deprecated.swift
//  
//
//  Created by Dominic Go on 8/5/24.
//

import Foundation

public extension ClassRegistry {
  
  @available(*, deprecated, message: "use shared instance instead")
  static var shouldCacheClasses: Bool {
    get {
      return true;
    }
    set {
      guard newValue == true else { return };
      self.shared.clearCache();
    }
  };
  
  @available(*, deprecated, message: "use shared instance instead")
  static var allClasses: [AnyClass] {
    if let allClasses = self.shared.allClassesCached {
      return allClasses;
    };
    
    let allClasses = Self.getAllClassesSync();
    self.shared.allClassesCached = allClasses;
    
    return allClasses;
	};
};

