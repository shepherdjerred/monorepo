//
//  UIControl+ClosureInjector.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/10/24.
//

import UIKit

public extension UIControl {
  func addAction(
    for controlEvent: UIControl.Event = .primaryActionTriggered,
    action: @escaping () -> Void
  ) {
    let injector = ClosureInjector(attachTo: self, closure: action);
    
    self.addTarget(
      injector,
      action: #selector(ClosureInjector.invoke),
      for: controlEvent
    );
  };
};
