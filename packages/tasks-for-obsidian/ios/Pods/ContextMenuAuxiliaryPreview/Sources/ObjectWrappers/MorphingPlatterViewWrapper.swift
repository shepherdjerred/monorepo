//
//  MorphingPlatterViewWrapper.swift
//  
//
//  Created by Dominic Go on 10/9/23.
//

import UIKit
import DGSwiftUtilities

/// Wrapper for: `_UIMorphingPlatterView`
/// Root container for the context menu preview
///
/// Available: iOS 17.1, 16.3, 15.2.1
///
@available(iOS 15, *)
 public class MorphingPlatterViewWrapper:
  PrivateObjectWrapper<UIView, MorphingPlatterViewWrapper.EncodedString> {
  
  public enum EncodedString: String, PrivateObjectWrappingEncodedString {
    case className;
    
    public var encodedString: String {
      switch self {
        case .className:
          // _UIMorphingPlatterView
          return "X1VJTW9ycGhpbmdQbGF0dGVyVmlldw==";
      };
    };
  };
};
