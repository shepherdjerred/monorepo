//
//  ClassMetadata.swift
//  
//
//  Created by Dominic Go on 12/27/24.
//

import Foundation


public struct ClassMetadata {

  public let classObject: AnyClass;
  public let className: String;

  public init?(_ classObject: AnyClass?) {
    guard classObject != nil else {
      return nil;
    };

    self.classObject = classObject!

    let classNameRaw: UnsafePointer<CChar> = class_getName(classObject);
    self.className = String(cString: classNameRaw);
  }

  public var superclassMetadata: Self? {
    guard let superclassObject = class_getSuperclass(self.classObject) else {
      return nil;
    };
    
    return .init(superclassObject);
  };
};

// MARK: ClassMetadata+CustomStringConvertible
// -------------------------------------------

extension ClassMetadata: CustomStringConvertible {
  
  public var description: String {
    return self.className;
  };
};

// MARK: ClassMetadata+Equatable
// -----------------------------

extension ClassMetadata: Equatable {
  
  public static func ==(lhs: Self, rhs: Self) -> Bool {
    return lhs.className == rhs.className;
  };
};
