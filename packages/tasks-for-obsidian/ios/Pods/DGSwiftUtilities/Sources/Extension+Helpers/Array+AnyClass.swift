//
//  Array+AnyClass.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 2/15/24.
//

import Foundation


public extension Array where Element == AnyClass {

  var asClassMetadata: [ClassMetadata] {
    self.compactMap {
      .init($0);
    };
  };

  func getClasses(descendantOfClass someClass: AnyClass) -> [AnyClass] {
    self.filter {
			var ancestor: AnyClass? = $0;
      
			while let type = ancestor {
				if ObjectIdentifier(type) == ObjectIdentifier(someClass) {
          return true;
        };
        
				ancestor = class_getSuperclass(type);
			};
      
			return false
		};
	};
 
  func getClasses(
    conformingToProtocol someProtocol: Protocol
  ) -> [AnyClass] {
		self.filter {
			var targetClass: AnyClass? = $0;
      
			while let someClass = targetClass {
				if class_conformsToProtocol(someClass, someProtocol) {
           return true;
        };
        
				targetClass = class_getSuperclass(someClass);
			};
      
			return false;
		};
	};
  
  func getClasses<T>(ofType someType: T.Type) -> [AnyClass] {
		return self.filter { $0 is T };
	};
};
