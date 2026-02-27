//
//  ContextMenuActionsListView.swift
//  ContextMenuAuxiliaryPreview
//
//  Created by Dominic Go on 4/2/24.
//

import UIKit
import DGSwiftUtilities


/// Wrapper for: _UlContextMenuActionsListView
///
@available(iOS 13, *)
public class ContextMenuActionsListView:
  PrivateObjectWrapper<UIView, ContextMenuActionsListView.EncodedString> {

  public enum EncodedString: String, PrivateObjectWrappingEncodedString {
    case className;
    
    public var encodedString: String {
      switch self {
        case .className:
          // _UlContextMenuActionsListView
          return "X1VJQ29udGV4dE1lbnVBY3Rpb25zTGlzdFZpZXc=";
      };
    };
  };
};
