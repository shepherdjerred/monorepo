//
//  TableViewCellReorderControl.swift
//  
//
//  Created by Dominic Go on 4/19/24.
//


import UIKit

@available(iOS 13, *)
public class TableViewCellReorderControlWrapper:
  PrivateObjectWrapper<UIView, TableViewCellReorderControlWrapper.EncodedString> {

  public enum EncodedString: String, PrivateObjectWrappingEncodedString {
    case className;
    
    public var encodedString: String {
      switch self {
        case .className:
          // UITableViewCellReorderControl
          return "VUlUYWJsZVZpZXdDZWxsUmVvcmRlckNvbnRyb2w=";
      };
    };
  };
  
  static var _didSwizzle = false;
  
  /// Fixes hit testing...
  public static func swizzleHitTestIfNeeded(){
    guard !Self._didSwizzle,
          let classType = Self.classType
    else { return };
  
    Self._didSwizzle = true;
    SwizzlingHelpers.swizzleHitTest(forClass: classType){ originalImp, selector in
      return { __self, point, event in
        let invokeOriginalImp = {
          return originalImp(__self, selector, point, event);
        };
        
        guard let _self = __self as? UIView else {
          return invokeOriginalImp();
        };
        
        let insetAdj = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 2);
        let boundsAdj = _self.bounds.inset(by: insetAdj);
        
        return boundsAdj.contains(point)
          ? invokeOriginalImp()
          : nil;
      };
    };
  };
};
