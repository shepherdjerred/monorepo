//
//  Transform3D+Deprecated.swift
//  
//
//  Created by Dominic Go on 12/4/24.
//

import QuartzCore


public extension Transform3D {
  
  @available(*, deprecated, renamed: "transform3D")
  var transform: CATransform3D {
    self.transform3D;
  };
  
  @available(*, deprecated, renamed: "identity")
  static var `default`: Self {
    .identity;
  };
};
