//
//  ImageConfigWithSize.swift
//  
//
//  Created by Dominic Go on 12/14/24.
//

import Foundation

public protocol ImageConfigWithSize: ImageConfig {
  
  var size: CGSize { set get };
};

// MARK: - ImageConfigWithSize+Helpers
// -----------------------------------

public extension ImageConfigWithSize {
  
  @discardableResult
  mutating func setSizeIfNotSet(_ newSize: CGSize) -> Bool {
    let nextWidth = self.size.width  <= 0
      ? newSize.width
      : self.size.width;
      
    let nextHeight = self.size.height <= 0
      ? newSize.height
      : self.size.height;
      
    let newSizeAdj = CGSize(width : nextWidth, height: nextHeight);
    return self.setSize(newSizeAdj);
  };
  
  @discardableResult
  mutating func setSize(_ newSize: CGSize) -> Bool {
    guard self.size != newSize else {
      return false;
    };
    
    self.size = newSize;
    self.cachedImage = nil;
    return true;
  };
};
