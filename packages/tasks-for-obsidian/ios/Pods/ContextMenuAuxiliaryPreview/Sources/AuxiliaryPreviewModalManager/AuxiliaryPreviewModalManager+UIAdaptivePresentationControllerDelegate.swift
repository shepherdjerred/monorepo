//
//  AuxiliaryPreviewModalManager+UIAdaptivePresentationControllerDelegate.swift
//  experiment-message-tap-back
//
//  Created by Dominic Go on 11/7/23.
//

import Foundation
import UIKit

extension AuxiliaryPreviewModalManager: UIAdaptivePresentationControllerDelegate {

  public func adaptivePresentationStyle(
    for controller: UIPresentationController,
    traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle {
    
    return .custom;
  };
};


