//
//  ContextMenuManagerDelegate.swift
//  
//
//  Created by Dominic Go on 10/22/23.
//

import UIKit


public protocol ContextMenuManagerDelegate: AnyObject {
  
  func onRequestMenuAuxiliaryPreview(sender: ContextMenuManager) -> UIView?
};
