//
//  ViewHelpers.swift
//  
//
//  Created by Dominic Go on 10/24/23.
//

import UIKit

public class ViewHelpers {

  public static func recursivelyGetAllSubviews(for view: UIView) -> [UIView] {
    var views: [UIView] = [];
    
    for subview in view.subviews {
      views += Self.recursivelyGetAllSubviews(for: subview);
      views.append(subview);
    };

    return views;
  };
  
  public static func recursivelyGetAllSuperViews(for view: UIView) -> [UIView] {
    var views: [UIView] = [];
    
    if let parentView = view.superview {
      views.append(parentView);
      views += Self.recursivelyGetAllSuperViews(for: parentView);
    };
    
    return views;
  };
  
  public static func compareImage(_ a: UIImage?, _ b: UIImage?) -> Bool {
    if (a == nil && b == nil){
      // both are nil, equal
      return true;
      
    } else if a == nil || b == nil {
      // one is nil, not equal
      return false;
      
    } else if a! === b! {
      // same ref to the object, true
      return true;
      
    } else if a!.size == b!.size {
      // size diff, not equal
      return true;
    };
    
    // compare raw data
    return a!.isEqual(b!);
  };
};
