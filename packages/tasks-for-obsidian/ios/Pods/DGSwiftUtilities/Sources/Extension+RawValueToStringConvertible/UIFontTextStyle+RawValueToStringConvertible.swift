//
//  UIFontTextStyle+RawValueToStringConvertible.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 4/14/24.
//

import UIKit

extension UIFont.TextStyle: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = {
    var cases: [Self] = [
      .body,
      .callout,
      .caption1,
      .caption2,
      .footnote,
      .headline,
      .subheadline,
      .largeTitle,
      .title1,
      .title2,
      .title3,
    ]

    if #available(iOS 17.0, *) {
      cases.append(.extraLargeTitle)
      cases.append(.extraLargeTitle2)
    }

    return cases
  }()

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    if #available(iOS 17.0, *) {
      switch self {
        case .extraLargeTitle:
          return "extraLargeTitle";
          
        case .extraLargeTitle2:
          return "extraLargeTitle2";
          
        default:
          break;
      };
    };
  
    switch self {
      case .body:
        return "body"
        
      case .callout:
        return "callout"
        
      case .caption1:
        return "caption1"
        
      case .caption2:
        return "caption2"
        
      case .footnote:
        return "footnote"
        
      case .headline:
        return "headline"
        
      case .subheadline:
        return "subheadline"
        
      case .largeTitle:
        return "largeTitle"
                  
      case .title1:
        return "title1"
        
      case .title2:
        return "title2"
        
      case .title3:
        return "title3"
        
      default:
        return "unknown";
    }
  }
}
