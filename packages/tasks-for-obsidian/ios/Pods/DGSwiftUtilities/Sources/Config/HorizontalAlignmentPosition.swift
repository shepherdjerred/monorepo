//
//  HorizontalAlignmentPosition.swift
//  
//
//  Created by Dominic Go on 10/25/23.
//

import UIKit

// TODO: Move to `DGSwiftUtilities`
public enum HorizontalAlignmentPosition: String {
  case stretch;
  case stretchTarget;
  
  case targetLeading;
  case targetTrailing;
  case targetCenter;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var shouldSetWidth: Bool {
    switch self {
      case .targetLeading, .targetTrailing, .targetCenter:
        return true;
      
      default:
        return false;
    };
  };
  
  public var isStretching: Bool {
       self == .stretch
    || self == .stretchTarget;
  };
  
  // MARK: - Functions
  // -----------------
  
  public func createHorizontalConstraints(
    forView view: UIView,
    attachingTo targetView: UIView,
    enclosingView: UIView,
    preferredWidth: CGFloat?,
    marginLeading: CGFloat = 0,
    marginTrailing: CGFloat = 0,
    shouldPreferWidthAnchor: Bool = false
  ) -> [NSLayoutConstraint] {
  
    var constraints: [NSLayoutConstraint?] = [];
  
    let widthAnchor: NSLayoutConstraint? = {
      guard let preferredWidth = preferredWidth else { return nil };
      
      return view.widthAnchor.constraint(
        equalToConstant: preferredWidth
      );
    }();
  
    switch self {
      // A - pin to left
      case .targetLeading:
        constraints += [
          widthAnchor,
          view.leadingAnchor.constraint(
            equalTo: targetView.leadingAnchor,
            constant: marginLeading
          ),
        ];
      
      // B - pin to right
      case .targetTrailing:
        constraints += [
          widthAnchor,
          view.trailingAnchor.constraint(
            equalTo: targetView.trailingAnchor,
            constant: -marginTrailing
          )
        ];
      
      // C - pin to center
      case .targetCenter:
        constraints +=  [
          widthAnchor,
          view.centerXAnchor.constraint(
            equalTo: targetView.centerXAnchor
          ),
        ];
      
      // D - match preview size
      case .stretchTarget:
        constraints += shouldPreferWidthAnchor ? [
          view.centerXAnchor.constraint(
            equalTo: targetView.centerXAnchor
          ),
          
          view.widthAnchor.constraint(
            equalToConstant: targetView.bounds.width
          ),
        ] : [
          view.leadingAnchor.constraint(
            equalTo: targetView.leadingAnchor,
            constant: marginLeading
          ),
          
          view.trailingAnchor.constraint(
            equalTo: targetView.trailingAnchor,
            constant: marginTrailing
          ),
        ];
      
      // E - stretch to edges of screen
      case .stretch:
        constraints += shouldPreferWidthAnchor ?  [
          view.centerXAnchor.constraint(
            equalTo: targetView.centerXAnchor
          ),
          
          view.widthAnchor.constraint(
            equalToConstant: enclosingView.bounds.width
          ),
        ] : [
         view.leadingAnchor.constraint(
           equalTo: enclosingView.leadingAnchor,
           constant: marginLeading
         ),

         view.trailingAnchor.constraint(
           equalTo: enclosingView.trailingAnchor,
           constant: marginTrailing
         ),
      ];
    };
    
    return constraints.compactMap { $0 };
  };
};
