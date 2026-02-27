//
//  CACornerMask+Helpers.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import UIKit


public extension CACornerMask {
  
  var isMaskingTopCorners: Bool {
       self.contains(.layerMinXMinYCorner)
    || self.contains(.layerMaxXMinYCorner);
  };
       
    
  var isMaskingLeftCorners: Bool {
       self.contains(.layerMinXMinYCorner)
    || self.contains(.layerMinXMaxYCorner);
  };
       
    
  var isMaskingBottomCorners: Bool {
       self.contains(.layerMinXMaxYCorner)
    || self.contains(.layerMaxXMaxYCorner);
  };
       
    
  var isMaskingRightCorners: Bool {
       self.contains(.layerMaxXMinYCorner)
    || self.contains(.layerMaxXMaxYCorner);
  };
  
  var count: Int {
    var count = 0;
  
    Self.uniqueElements.forEach {
      guard self.contains($0) else { return };
      count += 1;
    };
    
    return count;
  };
};
