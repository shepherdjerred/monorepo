//
//  ContextMenuPlatterTransitionViewWrapper.swift
//  
//
//  Created by Dominic Go on 10/8/23.
//

import UIKit
import DGSwiftUtilities

/// Wrapper for: `_UIContextMenuPlatterTransitionView`
///
/// This is a wrapper for the view that holds the "context menu items", and
/// the  "context menu preview".
///
/// Available: iOS 17, 16
///
@available(iOS 16, *)
public class ContextMenuPlatterTransitionViewWrapper:
  PrivateObjectWrapper<UIView, ContextMenuPlatterTransitionViewWrapper.EncodedString> {

  public enum EncodedString: String, PrivateObjectWrappingEncodedString {
    case className;
    
    public var encodedString: String {
      switch self {
        case .className:
          // _UIContextMenuPlatterTransitionView
          return "X1VJQ29udGV4dE1lbnVQbGF0dGVyVHJhbnNpdGlvblZpZXc=";
      };
    };
  };
  
  // MARK: - Computed Properties
  // ---------------------------
  
  /// Root container for the context menu items
  /// i.e. holds the context menu items
  public var contextMenuViewWrapper: ContextMenuViewWrapper? {
    guard let view = self.wrappedObject else { return nil };
    
    return view.subviews.reduce(nil) {
      $0 ?? .init(objectToWrap: $1)
    };
  };
  
  /// Root container for the context menu preview.
  /// i.e. holds the context menu preview.
  public var morphingPlatterViewWrapper: MorphingPlatterViewWrapper? {
    guard let view = self.wrappedObject else { return nil };
    
    return view.subviews.reduce(nil) {
      $0 ?? .init(objectToWrap: $1)
    };
  };
};

