//
//  VerticalAlignmentPosition.swift
//  react-native-ios-utilities
//
//  Created by Dominic Go on 5/14/24.
//

import UIKit


public enum VerticalAlignmentPosition: String {
  case stretch;
  case stretchTarget;
  
  case targetTop;
  case targetBottom;
  case targetCenter;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var shouldSetHeight: Bool {
    switch self {
      case .targetTop, .targetBottom, .targetCenter:
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
  
  public func createVerticalConstraints(
    forView view: UIView,
    attachingTo targetView: UIView,
    enclosingView: UIView,
    preferredHeight: CGFloat?,
    marginTop: CGFloat = 0,
    marginBottom: CGFloat = 0,
    shouldPreferHeightAnchor: Bool = false
  ) -> [NSLayoutConstraint] {
  
    var constraints: [NSLayoutConstraint?] = [];
  
    let heightAnchor: NSLayoutConstraint? = {
      guard let preferredHeight = preferredHeight else { return nil };
      
      return view.heightAnchor.constraint(
        equalToConstant: preferredHeight
      );
    }();
    
    let marginVertical = marginBottom + marginTop;
  
    switch self {
      case .targetTop:
        constraints += [
          heightAnchor,
          view.topAnchor.constraint(
            equalTo: targetView.topAnchor,
            constant: marginTop
          ),
        ];
      
      case .targetBottom:
        constraints += [
          heightAnchor,
          view.bottomAnchor.constraint(
            equalTo: targetView.bottomAnchor,
            constant: -marginBottom
          )
        ];
      
      case .targetCenter:
        constraints +=  [
          heightAnchor,
          view.centerYAnchor.constraint(
            equalTo: targetView.centerYAnchor
          ),
        ];
      
      case .stretchTarget:
        constraints += shouldPreferHeightAnchor ? [
          view.centerYAnchor.constraint(
            equalTo: targetView.centerYAnchor
          ),
          
          view.heightAnchor.constraint(
            equalToConstant: targetView.bounds.height - marginVertical
          ),
        ] : [
          view.topAnchor.constraint(
            equalTo: targetView.topAnchor,
            constant: marginTop
          ),
          
          view.bottomAnchor.constraint(
            equalTo: targetView.bottomAnchor,
            constant: marginBottom
          ),
        ];
      
      case .stretch:
        constraints += shouldPreferHeightAnchor ?  [
          view.centerYAnchor.constraint(
            equalTo: targetView.centerYAnchor
          ),
          
          view.widthAnchor.constraint(
            equalToConstant: enclosingView.bounds.width - marginVertical
          ),
        ] : [
         view.topAnchor.constraint(
           equalTo: enclosingView.topAnchor,
           constant: marginTop
         ),

         view.bottomAnchor.constraint(
           equalTo: enclosingView.bottomAnchor,
           constant: marginBottom
         ),
      ];
    };
    
    return constraints.compactMap { $0 };
  };
};
