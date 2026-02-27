//
//  AuxiliaryPreviewModalManager+UIViewControllerAnimatedTransitioning.swift
//  experiment-message-tap-back
//
//  Created by Dominic Go on 11/7/23.
//

import Foundation
import UIKit


extension AuxiliaryPreviewModalManager: UIViewControllerAnimatedTransitioning {

  public func transitionDuration(
    using transitionContext: UIViewControllerContextTransitioning?
  ) -> TimeInterval {
    return 1;
  };
  
  public func animateTransition(
    using transitionContext: UIViewControllerContextTransitioning
  ) {
  
    guard let presentationState = self.presentationState,
          let _ = transitionContext.viewController(forKey: .from)
    else { return };
    
    switch presentationState {
      case .presenting:
        let containerView = transitionContext.containerView;
        self.rootContainerView = containerView;
        
        self.setupViews();
        
        self.showModal() {
          transitionContext.completeTransition(true);
        };
        
      case .dismissing:
        self.hideModal() { [unowned self] in
          transitionContext.completeTransition(true);
          self.delegate?.onAuxiliaryPreviewModalDidHide(sender: self);
        };
    };
  };
};


