//
//  ContextMenuViewExtractorForIOS13.swift
//  ContextMenuAuxiliaryPreview
//
//  Created by Dominic Go on 4/2/24.
//
import UIKit
import DGSwiftUtilities

/// Works on iOS 13, 14
@available(iOS 13, *)
public struct ContextMenuViewExtractorForIOS13: AuxiliaryPreviewViewProvider  {

  public var contextMenuContainerViewWrapper: ContextMenuContainerViewWrapper;
  public var previewPlaterViewWrapper: PreviewPlaterViewWrapper;
  public var contextMenuActionsListViewWrapper: ContextMenuActionsListView?;
  
  public weak var contextMenuSharedRootView: UIView?;
  
  public var contextMenuWindowRootView: UIView? {
    self.contextMenuContainerViewWrapper.wrappedObject;
  };
  
  public var contextMenuPreviewRootView: UIView? {
    self.previewPlaterViewWrapper.wrappedObject;
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
    
    let previewPlaterViewWrapper: PreviewPlaterViewWrapper? = contextMenuSharedRootView.subviews.reduce(nil) {
      $0 ?? .init(objectToWrap: $1)
    };
    
    guard let previewPlaterViewWrapper = previewPlaterViewWrapper
    else { return nil };
 
    self.previewPlaterViewWrapper = previewPlaterViewWrapper;
    
    self.contextMenuActionsListViewWrapper = contextMenuSharedRootView.subviews.reduce(nil) {
      $0 ?? .init(objectToWrap: $1)
    };
  };
};
