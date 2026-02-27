//
//  ContextMenuViewExtractorForIOS15.swift
//  ContextMenuAuxiliaryPreview
//
//  Created by Dominic Go on 4/2/24.
//

import UIKit
import DGSwiftUtilities


/// Works on iOS 15 only...
@available(iOS 15, *)
public struct ContextMenuViewExtractorForIOS15: AuxiliaryPreviewViewProvider  {

  public var contextMenuContainerViewWrapper: ContextMenuContainerViewWrapper;
  public var morphingPlatterViewWrapper: MorphingPlatterViewWrapper;
  public var contextMenuActionsListViewWrapper: ContextMenuViewWrapper?;
  
  public weak var contextMenuSharedRootView: UIView?;
  
  public var contextMenuWindowRootView: UIView? {
    self.contextMenuContainerViewWrapper.wrappedObject;
  };
  
  public var contextMenuPreviewRootView: UIView? {
    self.morphingPlatterViewWrapper.wrappedObject;
  };
  
  public var contextMenuListRootView: UIView? {
    self.contextMenuActionsListViewWrapper?.wrappedObject;
  };

  public init?(usingManager contextMenuManager: ContextMenuManager){
  
    /// get wrapper for the "root view" that contains the context menu
    guard let contextMenuContainerViewWrapper =
            contextMenuManager.contextMenuContainerViewWrapper
    else { return nil };
    
    self.contextMenuContainerViewWrapper = contextMenuContainerViewWrapper;
    
    guard let contextMenuSharedRootView =
            contextMenuContainerViewWrapper.contextMenuSharedRootView
    else { return nil };
    
    self.contextMenuSharedRootView = contextMenuSharedRootView;
    
    let morphingPlatterViewWrapper: MorphingPlatterViewWrapper? = contextMenuSharedRootView.subviews.reduce(nil) {
      $0 ?? .init(objectToWrap: $1)
    };
    
    guard let morphingPlatterViewWrapper = morphingPlatterViewWrapper else { return nil };
    self.morphingPlatterViewWrapper = morphingPlatterViewWrapper;
    
    self.contextMenuActionsListViewWrapper = contextMenuSharedRootView.subviews.reduce(nil) {
      $0 ?? .init(objectToWrap: $1)
    };
  };
};

