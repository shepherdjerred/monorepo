//
//  UIStackView+Helpers.swift
//  
//
//  Created by Dominic Go on 6/15/24.
//

import UIKit

public extension UIStackView {
  
  func removeAllArrangedSubviews(){
    self.arrangedSubviews.forEach {
      $0.removeFromSuperview();
    };
  };
};
