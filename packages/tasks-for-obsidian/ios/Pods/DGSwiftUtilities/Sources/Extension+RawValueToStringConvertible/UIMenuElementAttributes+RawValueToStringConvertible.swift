//
//  UIMenuElementAttributes+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/18/23.
//

import UIKit

@available(iOS 13.0, *)
extension UIMenuElement.Attributes: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = {
    var cases: [Self] = [
      .hidden,
      .disabled,
      .destructive,
    ];
    
    #if !targetEnvironment(macCatalyst)
    #if swift(>=5.7)
    if #available(iOS 16.0, *) {
      cases.append(.keepsMenuPresented);
    };
    #endif
    #endif
    
    return cases;
  }();

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
  
    #if !targetEnvironment(macCatalyst)
    #if swift(>=5.7)
    if #available(iOS 16.0, *),
       self == .keepsMenuPresented {
       
      return "keepsMenuPresented";
    };
    #endif
    #endif
    
    switch self {
      case .hidden:
        return "hidden";
        
      case .disabled:
        return "disabled";
        
      case .destructive:
        return "destructive";
      
      default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif
        
        return "";
    };
  };
}
