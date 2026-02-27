//
//  AuxiliaryPreviewViewProvider.swift
//  ContextMenuAuxiliaryPreview
//
//  Created by Dominic Go on 4/1/24.
//

import UIKit
import DGSwiftUtilities


public protocol AuxiliaryPreviewViewProvider {

  /// This is the root view in the current window that contains all of the of
  /// the "context menu"-related views...
  var contextMenuWindowRootView: UIView? { get };
  
  /// This is the view that contains the "context menu preview"
  var contextMenuPreviewRootView: UIView? { get };
  
  /// This is the deepest view that contains both the
  /// "context menu preview" view, and the "context menu items" list view
  ///
  /// E.g. closest common ancestor - both "context menu preview", and
  /// "context menu items" share this view as their closest parent view...
  var contextMenuSharedRootView: UIView? { get };
  
  var contextMenuListRootView: UIView? { get };
};

public extension AuxiliaryPreviewViewProvider {
  
  var hasMenuItems: Bool {
    self.contextMenuListRootView != nil;
  };
};
