//
//  PreviewPlaterViewWrapper.swift
//  ContextMenuAuxiliaryPreview
//
//  Created by Dominic Go on 4/2/24.
//

import UIKit
import DGSwiftUtilities

/// Wrapper for: _UIPreviewPlatterView
///
@available(iOS 13, *)
public class PreviewPlaterViewWrapper:
  PrivateObjectWrapper<UIView, PreviewPlaterViewWrapper.EncodedString> {

  public enum EncodedString: String, PrivateObjectWrappingEncodedString {
    case className;
    
    public var encodedString: String {
      switch self {
        case .className:
          // _UIPreviewPlatterView
          return "X1VJUHJldmlld1BsYXR0ZXJWaWV3";
      };
    };
  };
};

