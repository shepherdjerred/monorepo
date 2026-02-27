//
//  AuxiliaryPreviewPopoverTargetMetadata.swift
//  
//
//  Created by Dominic Go on 11/16/23.
//

import UIKit
import DGSwiftUtilities

//
// +---------------+ 0   - topEdgeMax
// |               |
// +---------------+ 100 - topEdgeMin
// |               |
// |               | 200
// |               |
// +---------------+ 300 - bottomEdgeMin
// |               |
// +---------------+ 400 - bottomEdgeMax
//
struct AuxiliaryPreviewPopoverTargetMetadata {

  var parentScrollViewFrame: CGRect;
  var parentScrollViewGlobalFrame: CGRect;
      
  var targetFrame: CGRect;
  var targetGlobalFrame: CGRect;
  
  var minDistanceFromTopEdge: CGFloat;
  var minDistanceFromBottomEdge: CGFloat;
  
  var topEdgeMax: CGFloat;
  var bottomEdgeMax: CGFloat;
  
  var topEdgeMin: CGFloat;
  var bottomEdgeMin: CGFloat;
  
  var targetDistanceFromTopEdge: CGFloat;
  var targetDistanceFromBottomEdge: CGFloat;
  
  var isTargetAboveTopEdge: Bool;
  var isTargetBelowBottomEdge: Bool;
  var isTargetOutsideVerticalEdges: Bool;
  
  let scrollViewContentOffsetAdjY: CGFloat;
  
  init(
    auxiliaryPreviewModalManager: AuxiliaryPreviewModalManager,
    auxiliaryPreviewMetadata: AuxiliaryPreviewMetadata
  ) throws {
    
    let auxiliaryPreviewConfig =
      auxiliaryPreviewModalManager.auxiliaryPreviewConfig;
    
    guard let targetView = auxiliaryPreviewModalManager.targetView else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "`AuxiliaryPreviewModalManager.targetView` is nil"
      );
    };
    
    let targetFrame = targetView.frame;
    self.targetFrame = targetFrame;
    
    guard let window = targetView.window else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "`targetView.window` is nil"
      );
    };
  
    guard let parentScrollView =
            auxiliaryPreviewModalManager.targetViewParentScrollView else {
            
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "Could not find parent scroll view instance for `targetView`"
      );
    };
    
    let parentScrollViewFrame = parentScrollView.frame;
    self.parentScrollViewFrame = parentScrollViewFrame;
    
    guard let parentScrollViewGlobalFrame = parentScrollView.globalFrame else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "Could not get `globalFrame` for `parentScrollView`"
      );
    };
    
    self.parentScrollViewGlobalFrame = parentScrollViewGlobalFrame;
    
    guard let targetGlobalFrame = targetView.globalFrame else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "Could not get `globalFrame` from `targetView`"
      );
    };
    
    self.targetGlobalFrame = targetGlobalFrame;
    
    // MARK: Computation Start
    // -----------------------
    
    let safeAreaInsets = parentScrollView.safeAreaInsets;
    
    let minDistanceFromTopEdge: CGFloat = {
      switch auxiliaryPreviewMetadata.verticalAnchorPosition {
        case .top:
          return
              auxiliaryPreviewMetadata.computedHeight
            + auxiliaryPreviewConfig.marginInner
            + auxiliaryPreviewConfig.marginOuter;
        
        case .bottom:
          return auxiliaryPreviewConfig.marginOuter;
      };
    }();
    
    self.minDistanceFromTopEdge = minDistanceFromTopEdge;
    
    let minDistanceFromBottomEdge: CGFloat = {
      switch auxiliaryPreviewMetadata.verticalAnchorPosition {
        case .top:
          return auxiliaryPreviewConfig.marginOuter;
            
        case .bottom:
          return
              auxiliaryPreviewMetadata.computedHeight
            + auxiliaryPreviewConfig.marginInner
            + auxiliaryPreviewConfig.marginOuter;
      };
    }();
      
    self.minDistanceFromBottomEdge = minDistanceFromBottomEdge;
    
    let topEdgeMax = parentScrollViewGlobalFrame.minY;
    self.topEdgeMax = topEdgeMax;
    
    let bottomEdgeMax = parentScrollViewGlobalFrame.maxY;
    self.bottomEdgeMax = bottomEdgeMax;
    
    // TODO: WIP - does not account for top nav bar
    let topEdgeMin: CGFloat = {
      var topEdgeMin = topEdgeMax + minDistanceFromTopEdge;
      
      if topEdgeMax == 0 {
        topEdgeMin += safeAreaInsets.top;
      };
      
      return topEdgeMin;
    }();
      
    self.topEdgeMin = topEdgeMin;
     
    // TODO: WIP - does not account for bottom tab bar
    let bottomEdgeMin: CGFloat = {
      var bottomEdgeMin = bottomEdgeMax - minDistanceFromBottomEdge;
      
      if bottomEdgeMax == window.frame.maxY {
        bottomEdgeMin -= safeAreaInsets.bottom;
      };
      
      return bottomEdgeMin;
    }();
    
    self.bottomEdgeMin = bottomEdgeMin;
    
    /// "target min y" - "scrollview min y"
    ///
    /// * 0 means touching top edge
    /// * negative means offscreen top
    /// * positive means inside scrollview
    ///
    let targetDistanceFromTopEdge = targetGlobalFrame.minY - topEdgeMin;
    self.targetDistanceFromTopEdge = targetDistanceFromTopEdge;
    
    /// "target max y" - "scrollview max y"
    ///
    /// * 0 means touching bottom edge
    /// * negative means offscreen bottom
    /// * positive means inside
    ///
    let targetDistanceFromBottomEdge = bottomEdgeMin - targetGlobalFrame.maxY;
    self.targetDistanceFromBottomEdge = targetDistanceFromBottomEdge;
    
    let isTargetAboveTopEdge =
      targetDistanceFromTopEdge < minDistanceFromTopEdge;
      
    self.isTargetAboveTopEdge = isTargetAboveTopEdge;
      
    let isTargetBelowBottomEdge =
      targetDistanceFromBottomEdge < minDistanceFromBottomEdge;
      
    self.isTargetBelowBottomEdge = isTargetBelowBottomEdge;
    
    let isTargetOutsideVerticalEdges =
      isTargetAboveTopEdge || isTargetBelowBottomEdge;
      
    self.isTargetOutsideVerticalEdges = isTargetOutsideVerticalEdges;
    
    let scrollViewContentOffsetAdjY: CGFloat = {
      if isTargetAboveTopEdge {
        /// Note: This assumes that `topEdgeMax` is 0
        let offScreenAdj = targetGlobalFrame.minY < 0
          ? abs(targetGlobalFrame.minY)
          : 0;
          
        let baseAdj = targetGlobalFrame.minY >= 0
          ? (topEdgeMin - targetGlobalFrame.minY)
          : topEdgeMin;
        
        return -(offScreenAdj + baseAdj);
      };
      
      if isTargetBelowBottomEdge {
        let offScreenAdj = targetGlobalFrame.maxY > bottomEdgeMax
          ? targetGlobalFrame.maxY - bottomEdgeMax
          : 0;
          
        let baseAdj = targetGlobalFrame.maxY <= bottomEdgeMax
          ? targetGlobalFrame.maxY - bottomEdgeMin
          : bottomEdgeMax - bottomEdgeMin;
          
        return offScreenAdj + baseAdj;
      };
      
      return 0;
    }();
    
    self.scrollViewContentOffsetAdjY = scrollViewContentOffsetAdjY;
    self.debugPrint();
  };
  
  func debugPrint(){
    #if DEBUG
    print(
      "AuxiliaryPreviewPopoverScrolViewMetadata",
      "\n- parentScrollViewFrame:", self.parentScrollViewFrame,
      "\n- parentScrollViewGlobalFrame:", self.parentScrollViewGlobalFrame,
      "\n- targetFrame:", self.targetFrame,
      "\n- targetGlobalFrame:", self.targetGlobalFrame,
      "\n- minDistanceFromTopEdge:", self.minDistanceFromTopEdge,
      "\n- minDistanceFromBottomEdge:", self.minDistanceFromBottomEdge,
      "\n- topEdgeMax:", self.topEdgeMax,
      "\n- bottomEdgeMax:", self.bottomEdgeMax,
      "\n- topEdgeMin:", self.topEdgeMin,
      "\n- bottomEdgeMin:", self.bottomEdgeMin,
      "\n- targetDistanceFromTopEdge:", self.targetDistanceFromTopEdge,
      "\n- targetDistanceFromBottomEdge:", self.targetDistanceFromBottomEdge,
      "\n- isTargetAboveTopEdge:", self.isTargetAboveTopEdge,
      "\n- isTargetBelowBottomEdge:", self.isTargetBelowBottomEdge,
      "\n- isTargetOutsideVerticalEdges:", self.isTargetOutsideVerticalEdges,
      "\n- scrollViewContentOffsetAdjY:", self.scrollViewContentOffsetAdjY,
      "\n"
    );
    #endif
  };
};
