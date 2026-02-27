//
//  AuxiliaryPreviewModaPresentationController.swift
//  experiment-message-tap-back
//
//  Created by Dominic Go on 11/7/23.
//

import UIKit

class AuxiliaryPreviewModaPresentationController: UIPresentationController {

  weak var modalManager: AuxiliaryPreviewModalManager!;
  var shouldPauseLayoutUpdates = false;

  init(
    presentedViewController: UIViewController,
    presenting presentingViewController: UIViewController?,
    modalManager: AuxiliaryPreviewModalManager
  ) {
    super.init(
      presentedViewController: presentedViewController,
      presenting: presentingViewController
    );
    
    self.modalManager = modalManager;
  };
  
   override func presentationTransitionWillBegin() {
   };
  
   override func presentationTransitionDidEnd(_ completed: Bool) {
   };
   
  override func viewWillTransition(
    to size: CGSize,
    with coordinator: UIViewControllerTransitionCoordinator
  ) {
  
    super.viewWillTransition(to: size, with: coordinator);
  };
  
  override func containerViewWillLayoutSubviews(){
  };
  
  override func containerViewDidLayoutSubviews(){
    guard !self.shouldPauseLayoutUpdates else { return };
  };
};
