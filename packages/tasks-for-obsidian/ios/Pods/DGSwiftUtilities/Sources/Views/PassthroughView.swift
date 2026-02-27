//
//  PassthroughView.swift
//  
//
//  Created by Dominic Go on 7/5/23.
//

import UIKit

public class PassthroughView: UIView {
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard let hitView = super.hitTest(point, with: event) else { return nil };

    if hitView === self {
      return nil;
    };
    
    return hitView;
  };
};
