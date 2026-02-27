//
//  ObjectMetadata+Default.swift
//  react-native-ios-modal
//
//  Created by Dominic Go on 4/27/23.
//

import UIKit

fileprivate let ObjectMetadataMap = NSMapTable<AnyObject, AnyObject>(
  keyOptions: .weakMemory,
  valueOptions: .strongMemory
);

public extension ObjectMetadata {
  var metadata: T? {
    set {
      if let newValue = newValue {
        ObjectMetadataMap.setObject(newValue, forKey: self);
        
      } else {
        ObjectMetadataMap.removeObject(forKey: self);
      };
    }
    
    get {
      ObjectMetadataMap.object(forKey: self) as? T
    }
  };
};
