//
//  AuxiliaryPreviewEntranceTransitionConfig.swift
//  
//
//  Created by Dominic Go on 10/28/23.
//

import UIKit
import DGSwiftUtilities


public enum AuxiliaryPreviewEntranceTransitionConfig: CustomStringConvertible {

  // MARK: - Enum Cases
  // ------------------

  case syncedToMenuEntranceTransition(
    shouldAnimateSize: Bool = false
  );
  
  case customDelay(
    AuxiliaryPreviewTransitionAnimationConfig
  );
  
  case afterMenuEntranceTransition(
    AuxiliaryPreviewTransitionAnimationConfig
  );
  
  // MARK: - Computed Properties
  // ---------------------------
 
 public var description: String {
  switch self {
    case .syncedToMenuEntranceTransition:
      return "syncedToMenuEntranceTransition";
      
    case .customDelay:
      return "customDelay";
      
    case .afterMenuEntranceTransition:
      return "afterMenuEntranceTransition";
  };
 };
  
  public var transitionAnimationConfig: AuxiliaryPreviewTransitionAnimationConfig? {
    switch self {
      case .syncedToMenuEntranceTransition:
        return nil;
        
      case let .customDelay(config):
        return config;
        
      case let .afterMenuEntranceTransition(config):
        return config
    };
  };
};
