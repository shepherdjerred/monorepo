//
//  ContextMenuViewExtractorForIOS16.swift
//  ContextMenuAuxiliaryPreview
//
//  Created by Dominic Go on 4/1/24.
//

import UIKit
import DGSwiftUtilities

/// Works on iOS 16, 17
@available(iOS 16, *)
public struct ContextMenuViewExtractorForIOS16: AuxiliaryPreviewViewProvider  {

  public var contextMenuContainerViewWrapper: ContextMenuContainerViewWrapper;
  public var contextMenuPlatterTransitionViewWrapper: ContextMenuPlatterTransitionViewWrapper;
  public var morphingPlatterViewWrapper: MorphingPlatterViewWrapper;
  
  public var contextMenuViewWrapper: ContextMenuViewWrapper?;
  
  public var contextMenuWindowRootView: UIView? {
    self.contextMenuContainerViewWrapper.wrappedObject;
  };
  
  public var contextMenuPreviewRootView: UIView? {
    self.morphingPlatterViewWrapper.wrappedObject;
  };
  
  public var contextMenuSharedRootView: UIView? {
    self.contextMenuPlatterTransitionViewWrapper.wrappedObject;
  };
  
  public var contextMenuListRootView: UIView? {
    self.contextMenuViewWrapper?.wrappedObject;
  };

  public init?(usingManager contextMenuManager: ContextMenuManager){
  
    /// get wrapper for the "root view" that contains the context menu
    guard let contextMenuContainerViewWrapper =
            contextMenuManager.contextMenuContainerViewWrapper
    else { return nil };
    
    self.contextMenuContainerViewWrapper = contextMenuContainerViewWrapper;

    /// get wrapper for the "root view" that contains the "context menu items"
    /// + the "context menu preview"
    guard let contextMenuPlatterTransitionViewWrapper =
            contextMenuContainerViewWrapper.contextMenuPlatterTransitionViewWrapper
    else { return nil };
    
    self.contextMenuPlatterTransitionViewWrapper = contextMenuPlatterTransitionViewWrapper;
    
    /// get the wrapper for the root view that holds the
    /// "context menu preview".
    guard let morphingPlatterViewWrapper =
            contextMenuPlatterTransitionViewWrapper.morphingPlatterViewWrapper
    else { return nil };
    
    self.morphingPlatterViewWrapper = morphingPlatterViewWrapper;
    
    /// get the wrapper for the root view that holds the "context menu items"
    /// list.
    ///
    /// note: if you configure the "context menu" to not have any menu items,
    /// then this will be `nil`
    ///
    let contextMenuViewWrapper =
      contextMenuPlatterTransitionViewWrapper.contextMenuViewWrapper;
      
    self.contextMenuViewWrapper = contextMenuViewWrapper;
  };
};
