//
//  ComputableLayoutValuePercentTarget.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 6/8/23.
//

import UIKit

public enum ComputableLayoutValuePercentTarget: String, CaseIterable {

  case screenSize , screenWidth , screenHeight;
  case windowSize , windowWidth , windowHeight;
  case targetSize , targetWidth , targetHeight;
  case currentSize, currentWidth, currentHeight;
  
  public func getValue(
    layoutValueContext context: ComputableLayoutValueContext,
    preferredSizeKey: KeyPath<CGSize, CGFloat>?
  ) -> CGFloat? {
  
    switch self {
      case .screenSize:
        guard let preferredSizeKey = preferredSizeKey else { return nil };
        return context.screenSize[keyPath: preferredSizeKey];
        
      case .screenWidth:
        return context.screenSize.width;
        
      case .screenHeight:
        return context.screenSize.height;
        
      case .windowSize:
        guard let preferredSizeKey = preferredSizeKey else { return nil };
        return context.windowSize?[keyPath: preferredSizeKey];
        
      case .windowWidth:
        return context.windowSize?.width;
        
      case .windowHeight:
        return context.windowSize?.height;
        
      case .targetSize:
        guard let preferredSizeKey = preferredSizeKey else { return nil };
        return context.targetSize[keyPath: preferredSizeKey];
        
      case .targetWidth:
        return context.targetSize.width;
        
      case .targetHeight:
        return context.targetSize.height;
        
      case .currentSize:
        guard let preferredSizeKey = preferredSizeKey else { return nil };
        return context.currentSize?[keyPath: preferredSizeKey];
        
      case .currentWidth:
        return context.currentSize?.width;
        
      case .currentHeight:
        return context.currentSize?.height;
    };
  };
};
