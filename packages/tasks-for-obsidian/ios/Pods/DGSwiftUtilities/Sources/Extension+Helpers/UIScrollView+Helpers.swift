//
//  UIScrollView+Helpers.swift
//  adaptive-modal-example
//
//  Created by Dominic Go on 7/9/23.
//

import UIKit

public extension UIScrollView {

  var minContentOffset: CGPoint {
    return CGPoint(
      x: -self.contentInset.left,
      y: -self.contentInset.top
    );
  };

  var maxContentOffset: CGPoint {
    return CGPoint(
      x: self.contentSize.width  - self.bounds.width  + self.contentInset.right,
      y: self.contentSize.height - self.bounds.height + self.contentInset.bottom
    );
  }

  func scrollToMinContentOffset(animated: Bool) {
    self.setContentOffset(minContentOffset, animated: animated);
  }

  func scrollToMaxContentOffset(animated: Bool) {
    self.setContentOffset(maxContentOffset, animated: animated);
  };
};

