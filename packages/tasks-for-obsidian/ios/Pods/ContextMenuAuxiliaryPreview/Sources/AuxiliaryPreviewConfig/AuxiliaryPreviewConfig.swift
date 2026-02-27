//
//  AuxiliaryPreviewConfig.swift
//  
//
//  Created by Dominic Go on 10/9/23.
//
import Foundation
import UIKit
import DGSwiftUtilities


public struct AuxiliaryPreviewConfig {
  
  // MARK: - Properties
  // ------------------

  public var verticalAnchorPosition: VerticalAnchorPositionMode;
  public var horizontalAlignment: HorizontalAlignmentPosition;
  
  public var preferredWidth: AuxiliaryPreviewSizeValue?;
  public var preferredHeight: AuxiliaryPreviewSizeValue?;
  
  /// The distance between the aux. preview, and the menu preview
  public var marginInner: CGFloat;
  
  /// The min. distance of the aux. preview from the edges of the window
  public var marginOuter: CGFloat;

  public var transitionConfigEntrance: AuxiliaryPreviewEntranceTransitionConfig;
  
  public var transitionExitPreset: AuxiliaryPreviewTransitionPreset;
  public var transitionConfigExit: AuxiliaryPreviewTransitionConfig;
  
  // MARK: - Init
  // ------------
  
  public init(
    verticalAnchorPosition: VerticalAnchorPositionMode,
    horizontalAlignment: HorizontalAlignmentPosition,
    preferredWidth: AuxiliaryPreviewSizeValue? = nil,
    preferredHeight: AuxiliaryPreviewSizeValue? = nil,
    marginInner: CGFloat,
    marginOuter: CGFloat,
    transitionConfigEntrance: AuxiliaryPreviewEntranceTransitionConfig,
    transitionExitPreset: AuxiliaryPreviewTransitionPreset
  ) {
  
    self.verticalAnchorPosition = verticalAnchorPosition;
    self.horizontalAlignment = horizontalAlignment;
    self.preferredWidth = preferredWidth;
    self.preferredHeight = preferredHeight;
    self.marginInner = marginInner;
    self.marginOuter = marginOuter;
    self.transitionConfigEntrance = transitionConfigEntrance;
    
    self.transitionExitPreset = transitionExitPreset;
    self.transitionConfigExit = {
      var transitionConfigExit = AuxiliaryPreviewTransitionConfig(
        transitionPreset: transitionExitPreset
      );
        
      transitionConfigExit.reverseKeyframes();
      return transitionConfigExit;
    }();
  };
};
