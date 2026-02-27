//
//  ContextMenuManager+AuxiliaryPreviewModalManagerDelegate.swift
//  
//
//  Created by Dominic Go on 11/13/23.
//

import Foundation

extension ContextMenuManager: AuxiliaryPreviewModalManagerDelegate {

  public func onAuxiliaryPreviewModalDidHide(sender: AuxiliaryPreviewModalManager) {
    self.auxiliaryPreviewModalManager = nil;
  };
};
