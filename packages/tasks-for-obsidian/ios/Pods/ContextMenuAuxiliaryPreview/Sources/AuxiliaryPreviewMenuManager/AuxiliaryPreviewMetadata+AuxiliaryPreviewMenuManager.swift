//
//  AuxiliaryPreviewMenuMetadata+AuxiliaryPreviewMenuManager.swift
//  
//
//  Created by Dominic Go on 11/10/23.
//

import UIKit

extension AuxiliaryPreviewMetadata {

  // MARK: - Computed Properties
  // ---------------------------
  
  var computedWidthAdjusted: CGFloat {
    /// adjust width - fix for layout bug
    ///
    /// if you use the actual width, it triggers a bug w/ autolayout where the
    /// aux. preview snaps to the top of the screen...
    ///
    return self.computedWidth + 0.5;
  };
  
  // MARK: - Init
  // ------------

  init?(auxiliaryPreviewMenuManager: AuxiliaryPreviewMenuManager) {
  
    guard let window = auxiliaryPreviewMenuManager.window,
          let contextMenuManager = auxiliaryPreviewMenuManager.contextMenuManager,
          let auxiliaryPreviewConfig = contextMenuManager.auxiliaryPreviewConfig,
          let auxiliaryPreviewView = contextMenuManager.auxiliaryPreviewView
    else { return nil };
    
    let contextMenuMetadata = auxiliaryPreviewMenuManager.contextMenuMetadata;
  
    let sizeValueContext = AuxiliaryPreviewSizeValue.Context(
      windowSize: window.bounds.size,
      previewFrame: auxiliaryPreviewView.frame
    );
    
    self.sizeValueContext = sizeValueContext;
    
    self.verticalAnchorPosition = {
      let preferredVerticalAnchorPosition = auxiliaryPreviewConfig.verticalAnchorPosition;
        
      if let anchorPosition = preferredVerticalAnchorPosition.verticalAnchorPosition {
        return anchorPosition;
      };
      
      if let menuPosition = contextMenuMetadata.menuPosition {
        return menuPosition.opposite;
      };
      
      // the context menu does not have menu items, determine anchor position
      // of auxiliary view via the position of the preview in the screen
      return contextMenuMetadata.menuPreviewPosition.opposite;
    }();
    
    self.computedWidth = {
      let computedWidth = auxiliaryPreviewConfig.preferredWidth?.compute(
        computingForSizeKey: \.width,
        usingContext: sizeValueContext
      );
      
      let fallbackWidth: CGFloat = {
        switch auxiliaryPreviewConfig.horizontalAlignment {
          case .stretch:
            return contextMenuMetadata.rootContainerFrame.size.width;
        
          case .stretchTarget:
            return contextMenuMetadata.menuPreviewFrame.size.width;
            
          default:
            return auxiliaryPreviewView.frame.width;
        };
      }();
      
      return computedWidth ?? fallbackWidth;
    }();
    
    let computedHeight: CGFloat = {
      let computedHeight: CGFloat? = auxiliaryPreviewConfig.preferredHeight?.compute(
        computingForSizeKey: \.height,
        usingContext: sizeValueContext
      );
      
      let fallbackHeight = auxiliaryPreviewView.frame.height;
      return computedHeight ?? fallbackHeight;
    }();
    
    self.computedHeight = computedHeight;
    
    self.offsetY = {
      let safeAreaInsets = window.safeAreaInsets;
      let previewFrame = contextMenuMetadata.menuPreviewFrame;
      let windowHeight = window.bounds.height;
      
      let marginBase =
          auxiliaryPreviewConfig.marginInner
        + auxiliaryPreviewConfig.marginOuter;
      
      switch contextMenuMetadata.menuPreviewPosition {
        case .top:
          let margin = marginBase + safeAreaInsets.top;
          
          let minEdgeY = computedHeight + margin;
          let distanceToEdge = computedHeight - previewFrame.minY;
        
          return (previewFrame.minY <= minEdgeY)
            ? max((distanceToEdge + margin), 0)
            : 0;
          
        case .bottom:
          let margin = marginBase + safeAreaInsets.bottom;
          
          let tolerance = computedHeight + margin;
          let maxEdgeY = windowHeight - tolerance;
          
          let previewFrameMaxY =
              previewFrame.maxY
            + auxiliaryPreviewConfig.marginInner;
          
          let distanceToEdge = windowHeight - previewFrame.maxY;
          
          return (previewFrameMaxY > maxEdgeY)
            ? -(computedHeight - distanceToEdge + margin)
            : 0;
      };
    }();
  };
};
