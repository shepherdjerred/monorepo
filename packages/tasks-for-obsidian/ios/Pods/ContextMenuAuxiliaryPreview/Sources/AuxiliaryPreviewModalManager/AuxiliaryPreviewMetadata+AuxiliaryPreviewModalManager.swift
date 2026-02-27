//
//  AuxiliaryPreviewMenuMetadata+AuxiliaryPreviewModalManager.swift
//  
//
//  Created by Dominic Go on 11/10/23.
//

import Foundation

extension AuxiliaryPreviewMetadata {

  init?(auxiliaryPreviewModalManager manager: AuxiliaryPreviewModalManager) {
  
    guard let presentedController = manager.presentedController,
          let auxiliaryPreviewController = manager.auxiliaryPreviewController,
          
          let targetView = manager.targetView,
          let targetViewGlobalFrame = targetView.globalFrame,
          
          let window = targetView.window
    else { return nil };
    
    let auxiliaryPreviewConfig = manager.auxiliaryPreviewConfig;
  
    let sizeValueContext = AuxiliaryPreviewSizeValue.Context(
      windowSize: window.bounds.size,
      previewFrame: targetViewGlobalFrame
    );
    
    self.sizeValueContext = sizeValueContext;
    
    let computedWidth: CGFloat = {
      let computedWidth = auxiliaryPreviewConfig.preferredWidth?.compute(
        computingForSizeKey: \.width,
        usingContext: sizeValueContext
      );
      
      let fallbackWidth: CGFloat = {
        switch auxiliaryPreviewConfig.horizontalAlignment {
          case .stretch:
            return presentedController.view.frame.width;
        
          case .stretchTarget:
            return targetViewGlobalFrame.size.width;
            
          default:
            return max(
              auxiliaryPreviewController.preferredContentSize.width,
              auxiliaryPreviewController.view.frame.size.width
            );
        };
      }();
      
      return computedWidth ?? fallbackWidth;
    }();
    
    self.computedWidth = computedWidth;
    
    let computedHeight = {
      let computedHeight = auxiliaryPreviewConfig.preferredHeight?.compute(
        computingForSizeKey: \.height,
        usingContext: sizeValueContext
      );
      
      let fallbackHeight = max(
        auxiliaryPreviewController.preferredContentSize.height,
        auxiliaryPreviewController.view.frame.size.height
      );
        
      return computedHeight ?? fallbackHeight;
    }();
    
    self.computedHeight = computedHeight;
    
    let verticalAnchorPosition = {
      let preferredAnchorPosition = auxiliaryPreviewConfig.verticalAnchorPosition;
      
      if let preferredAnchorPosition = preferredAnchorPosition.verticalAnchorPosition {
        return preferredAnchorPosition;
      };
      
      switch auxiliaryPreviewConfig.verticalAnchorPosition {
        case .top:
          return .top;
        
        case .bottom:
          return .bottom;
          
        case .automatic:
          let targetViewY = targetViewGlobalFrame.midY;
          let rootViewY = presentedController.view.frame.midY;
          
          return targetViewY <= rootViewY ? .bottom : .top
      };
    }();
    
    self.verticalAnchorPosition = verticalAnchorPosition;
    
    self.offsetY = {
      // Make a partial/incomplete dummy copy
      let auxiliaryPreviewMetadata = AuxiliaryPreviewMetadata(
        verticalAnchorPosition: verticalAnchorPosition,
        computedHeight: computedHeight,
        computedWidth: computedWidth,
        offsetY: 0,
        sizeValueContext: sizeValueContext
      );
    
      let targetOffsetMetadata = try? AuxiliaryPreviewPopoverTargetMetadata(
        auxiliaryPreviewModalManager: manager,
        auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
      );
      
      guard let targetOffsetMetadata = targetOffsetMetadata else { return 0 };
      return targetOffsetMetadata.scrollViewContentOffsetAdjY;
    }();
  };
};
