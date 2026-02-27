//
//  ContextMenuContainerView.swift.swift
//  
//
//  Created by Dominic Go on 10/8/23.
//

import UIKit
import DGSwiftUtilities


/// Wrapper for: _UIContextMenuContainerView
/// This is the "root view" that contains the context menut
///
/// **Note**: This `UIView` instance  only exists whenever there's a
/// context menu interaction.
///
/// Available: iOS 17, 16, 15, 14, 13
///
@available(iOS 13, *)
public class ContextMenuContainerViewWrapper:
  PrivateObjectWrapper<UIView, ContextMenuContainerViewWrapper.EncodedString> {

  public enum EncodedString: String, PrivateObjectWrappingEncodedString {
    case className;
    
    public var encodedString: String {
      switch self {
        case .className:
          // _UIContextMenuContainerView
          return "X1VJQ29udGV4dE1lbnVDb250YWluZXJWaWV3";
      };
    };
  };

  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var backgroundVisualEffectView: UIVisualEffectView? {
    guard let view = self.wrappedObject else { return nil };
    
    return view.subviews.reduce(nil){
      $0 ?? ($1 as? UIVisualEffectView)
    };
  };
  
  /// Returns the "object wrapper" for the view contains the
  ///  "context menu items" + "context menu preview".
  @available(iOS 16, *)
  public var contextMenuPlatterTransitionViewWrapper: ContextMenuPlatterTransitionViewWrapper? {
    guard let view = self.wrappedObject else { return nil };
    
    return view.subviews.reduce(nil) {
      $0 ?? .init(objectToWrap: $1)
    };
  };
  
  /// This is the view that contains both the "context menu preview" view, and
  /// the "context menu items" list view.
  ///
  /// On iOS 13 to 15, this view is just a regular `UIView` instance, but
  /// starting on iOS 16, it became a custom subclass called:
  ///  `_UIContextMenuPlatterTransitionView`
  ///
  public var contextMenuSharedRootView: UIView? {
    guard let view = self.wrappedObject else { return nil };
    
    return view.subviews.first {
         !($0 is UIVisualEffectView)
      && $0.subviews.count > 0
      && $0.constraints.count > 0;
    };
  };
};
