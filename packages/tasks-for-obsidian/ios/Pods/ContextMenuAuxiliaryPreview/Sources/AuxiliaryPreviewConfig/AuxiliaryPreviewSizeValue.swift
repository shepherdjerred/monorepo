//
//  AuxiliaryPreviewSizeValue.swift
//  
//
//  Created by Dominic Go on 10/25/23.
//

import Foundation


public enum AuxiliaryPreviewSizeValue {

  struct Context {
    // TODO: Add property `encolosingViewFrame`
    var windowSize: CGSize?;
    var previewFrame: CGRect;
  };
  
  case constant(CGFloat);
  case percentRelativeToWindow(CGFloat);
  case percentRelativeToPreview(CGFloat);
  
  case multipleValues([Self]);
  
  func compute(
    computingForSizeKey sizeKey: KeyPath<CGSize, CGFloat>,
    usingContext context: Context
  ) -> CGFloat? {
  
    switch self {
      case let .constant(sizeValue):
        return sizeValue;
        
      case let .percentRelativeToWindow(percent):
        guard let windowSize = context.windowSize else { return nil };
        
        let sizeValue = windowSize[keyPath: sizeKey];
        return sizeValue * percent;
        
      case let .percentRelativeToPreview(percent):
        let sizeValue = context.previewFrame.size[keyPath: sizeKey];
        return sizeValue * percent;
      
      case let .multipleValues(sizeValues):
        let computedSizes = sizeValues.compactMap {
          $0.compute(
            computingForSizeKey: sizeKey,
            usingContext: context
          );
        };
      
        return computedSizes.reduce(0) {
          $0 + $1;
        };
    };
  };
};
