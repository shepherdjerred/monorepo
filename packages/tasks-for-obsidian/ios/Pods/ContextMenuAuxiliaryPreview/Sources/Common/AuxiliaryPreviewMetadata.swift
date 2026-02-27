//
//  AuxiliaryPreviewMenuMetadata.swift
//  
//
//  Created by Dominic Go on 10/27/23.
//

import UIKit
import DGSwiftUtilities


public struct AuxiliaryPreviewMetadata {
  
  /// whether to attach the `auxiliaryView` on the top or bottom
  var verticalAnchorPosition: VerticalAnchorPosition;
  
  var computedHeight: CGFloat;
  var computedWidth: CGFloat;
  
  var offsetY: CGFloat;
  
  var sizeValueContext: AuxiliaryPreviewSizeValue.Context;
  
  // MARK: - Init
  // ------------
  
  init(
    verticalAnchorPosition: VerticalAnchorPosition,
    computedHeight: CGFloat,
    computedWidth: CGFloat,
    offsetY: CGFloat,
    sizeValueContext: AuxiliaryPreviewSizeValue.Context
  ) {
  
    self.verticalAnchorPosition = verticalAnchorPosition;
    self.computedHeight = computedHeight;
    self.computedWidth = computedWidth;
    self.offsetY = offsetY;
    self.sizeValueContext = sizeValueContext;
  };
};
