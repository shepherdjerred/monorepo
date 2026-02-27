//
//  AuxiliaryPreviewModalManager.swift
//  experiment-message-tap-back
//
//  Created by Dominic Go on 11/7/23.
//

import UIKit
import DGSwiftUtilities



public class AuxiliaryPreviewModalManager: NSObject {

  // MARK: - Embedded Types
  // ----------------------
  
  enum PresentationState {
    case presenting;
    case dismissing;
  };
  
  // MARK: - Properties
  // ------------------
  
  var auxiliaryPreviewConfig: AuxiliaryPreviewConfig;
  var auxiliaryPreviewMetadata: AuxiliaryPreviewMetadata?;
  
  weak var delegate: AuxiliaryPreviewModalManagerDelegate?;

  var presentationState: PresentationState?;
  
  // MARK: - Layout Related
  // ----------------------
  
  /// A ref. to the view controller that presented `presentedController`
  weak var presentingController: UIViewController?;
  
  /// This is the view controller that was presented by `presentingController`
  /// Note: This is the parent controller of `auxiliaryPreviewController`/
  var presentedController: AuxiliaryPreviewModalWrapperViewController?;
  
  /// The view controller that holds the "auxiliary preview view".
  /// Note: This is a child controller of `presentedController`
  var auxiliaryPreviewController: UIViewController?;
  
  /// A ref. to the "original" view where the "auxiliary preview view" will be
  /// anchored/attached to
  weak var targetView: UIView?;
  
  /// The view where `presentedController` will be attached to
  var rootContainerView: UIView?;
  
  var dimmingView: UIView?;
  
  weak var auxiliaryPreviewWidthConstraint: NSLayoutConstraint?;
  weak var auxiliaryPreviewHeightConstraint: NSLayoutConstraint?;
  
  weak var targetViewParentScrollView: UIScrollView?;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  var auxiliaryPreviewView: UIView? {
    self.auxiliaryPreviewController?.view
  };
  
  var isPresenting: Bool {
    guard let presentedController = self.presentedController else { return false };
    let presentingController = presentedController.presentingViewController;
    
    let isPresentingModalWrapperVC =
      presentingController?.presentedViewController === presentedController;
      
    return presentedController.isBeingPresented || isPresentingModalWrapperVC;
  };
  
  // MARK: - Init
  // ------------
  
  init(auxiliaryPreviewConfig: AuxiliaryPreviewConfig) {
    self.auxiliaryPreviewConfig = auxiliaryPreviewConfig;
    super.init();
  };
  
  // MARK: - Functions - Setup
  // -------------------------
  
  func setupViews(){
    guard let rootContainerView = self.rootContainerView,
          let presentedController = self.presentedController,
          let auxiliaryPreviewController = self.auxiliaryPreviewController,
          let targetView = self.targetView,
          
          let targetViewSnapshot =
            targetView.snapshotView(afterScreenUpdates: true),

          let auxiliaryPreviewMetadata = self.auxiliaryPreviewMetadata
    else { return };
    
    let auxiliaryPreviewConfig = self.auxiliaryPreviewConfig;
    
    presentedController.view.translatesAutoresizingMaskIntoConstraints = false;
    rootContainerView.addSubview(presentedController.view)
    
    NSLayoutConstraint.activate([
      presentedController.view.leadingAnchor.constraint(
        equalTo: rootContainerView.leadingAnchor
      ),
      presentedController.view.trailingAnchor.constraint(
        equalTo: rootContainerView.trailingAnchor
      ),
      presentedController.view.topAnchor.constraint(
        equalTo: rootContainerView.topAnchor
      ),
      presentedController.view.bottomAnchor.constraint(
        equalTo: rootContainerView.bottomAnchor
      ),
    ]);
    
    let dimmingView: UIView = {
      let view = UIView();
      view.alpha = 0;
      view.backgroundColor = .black;
      
      let tapGesture = UITapGestureRecognizer(
        target: self,
        action: #selector(Self.handleOnTapDimmingView(_:))
      );
      
      tapGesture.isEnabled = true;
      view.addGestureRecognizer(tapGesture);
      
      return view;
    }();
    
    self.dimmingView = dimmingView;
    
    dimmingView.translatesAutoresizingMaskIntoConstraints = false;
    presentedController.view.addSubview(dimmingView)
    
    NSLayoutConstraint.activate([
      dimmingView.leadingAnchor.constraint(
        equalTo: presentedController.view.leadingAnchor
      ),
      dimmingView.trailingAnchor.constraint(
        equalTo: presentedController.view.trailingAnchor
      ),
      dimmingView.topAnchor.constraint(
        equalTo: presentedController.view.topAnchor
      ),
      dimmingView.bottomAnchor.constraint(
        equalTo: presentedController.view.bottomAnchor
      ),
    ]);
    
    targetViewSnapshot.frame = targetView.globalFrame ?? targetView.frame;
    presentedController.view.addSubview(targetViewSnapshot);
    
    auxiliaryPreviewController.view.translatesAutoresizingMaskIntoConstraints = false;
    presentedController.view.addSubview(auxiliaryPreviewController.view);
    
    let keyframeStart: AuxiliaryPreviewTransitionKeyframe = {
      let transitionAnimationConfig = auxiliaryPreviewConfig
        .transitionConfigEntrance.transitionAnimationConfig ?? .default;
        
      let keyframes = transitionAnimationConfig.transition.getKeyframes(
        auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
      );
        
      return keyframes.keyframeStart;
    }();
    
    let auxiliaryPreviewViewHeight: CGFloat = {
      guard let height = keyframeStart.auxiliaryPreviewPreferredHeight else {
        return auxiliaryPreviewMetadata.computedHeight;
      };
      
      return height;
    }();
    
    let auxiliaryPreviewViewWidth: CGFloat = {
      guard let width = keyframeStart.auxiliaryPreviewPreferredWidth else {
        return auxiliaryPreviewMetadata.computedWidthAdjusted;
      };
      
      return width;
    }();
    
    let constraints: [NSLayoutConstraint] = {
      var constraints: [NSLayoutConstraint] = [];
      
      constraints.append({
        let constraint = auxiliaryPreviewController.view.heightAnchor.constraint(
          equalToConstant: auxiliaryPreviewViewHeight
        );
        
        self.auxiliaryPreviewHeightConstraint = constraint;
        return constraint;
      }());
      
      constraints.append(
        auxiliaryPreviewMetadata.verticalAnchorPosition.createVerticalConstraints(
          forView: auxiliaryPreviewController.view,
          attachingTo: targetViewSnapshot,
          margin: auxiliaryPreviewConfig.marginInner
        )
      );
      
      constraints += {
        let horizontalAlignment =
          self.auxiliaryPreviewConfig.horizontalAlignment;
          
        let constraints = horizontalAlignment.createHorizontalConstraints(
          forView: auxiliaryPreviewController.view,
          attachingTo: targetViewSnapshot,
          enclosingView: presentedController.view,
          preferredWidth: auxiliaryPreviewViewWidth
        );
        
        self.auxiliaryPreviewWidthConstraint = constraints.first {
          $0.firstAttribute == .width;
        };
        
        return constraints;
      }();
    
      return constraints;
    }();
    
    NSLayoutConstraint.activate(constraints);
  };
  
  func showModal(completion: (() -> Void)? = nil){
    guard let auxiliaryPreviewView = self.auxiliaryPreviewView,
          let targetView = self.targetView,
          let auxiliaryPreviewMetadata = self.auxiliaryPreviewMetadata
    else { return };
    
    let transitionConfigEntrance =
      self.auxiliaryPreviewConfig.transitionConfigEntrance;
    
    let transitionAnimationConfig =
      transitionConfigEntrance.transitionAnimationConfig ?? .default;
    
    let keyframes = transitionAnimationConfig.transition.getKeyframes(
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    let animator = transitionAnimationConfig.animatorConfig.createAnimator(
      gestureInitialVelocity: .zero
    );
    
    keyframes.keyframeStart.apply(
      auxiliaryPreviewView: auxiliaryPreviewView,
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    animator.addAnimations {
      self.dimmingView?.alpha = 0.25;
    
      keyframes.keyframeEnd.apply(
        auxiliaryPreviewView: auxiliaryPreviewView,
        auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
      );
    };
    
    animator.addCompletion { _ in
      completion?();
    };
    
    targetView.alpha = 0;
    animator.startAnimation(afterDelay: transitionAnimationConfig.delay);
  };
  
  func hideModal(completion: (() -> Void)? = nil){
    guard let targetView = self.targetView,
          let auxiliaryPreviewView = self.auxiliaryPreviewView,
          let auxiliaryPreviewMetadata = self.auxiliaryPreviewMetadata
    else { return };
    
    let animatorConfig: AnimationConfig =
      .presetCurve(duration: 0.2, curve: .easeOut);
    
    let animator =
      animatorConfig.createAnimator(gestureInitialVelocity: .zero);
    
    let transitionConfigExit = self.auxiliaryPreviewConfig.transitionConfigExit;
    let (exitKeyframe, _) = transitionConfigExit.getKeyframes(
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    animator.addAnimations {
      self.dimmingView?.alpha = 0;
      
      exitKeyframe.apply(
        auxiliaryPreviewView: auxiliaryPreviewView,
        auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
      );
    };
    
    animator.addCompletion() { _ in
      completion?();
    };
    
    targetView.alpha = 1;
    animator.startAnimation();
  };
  
  @objc func handleOnTapDimmingView(_ sender: UITapGestureRecognizer){
    self.presentedController?.dismiss(animated: true);
  };
  
  // MARK: - Functions
  // -----------------
  
  func present(
    viewControllerToPresent auxiliaryPreviewController: UIViewController,
    presentingViewController presentingController: UIViewController,
    targetView: UIView
  ) {
    
    self.auxiliaryPreviewController = auxiliaryPreviewController;
    self.presentingController = presentingController;
    self.targetView = targetView;
    
    let presentedController = AuxiliaryPreviewModalWrapperViewController();
    self.presentedController = presentedController;
    
    presentedController.addChild(auxiliaryPreviewController);
    presentedController.didMove(toParent: auxiliaryPreviewController);
    
    presentedController.modalPresentationStyle = .custom;
    presentedController.transitioningDelegate = self;
    
    let targetViewParentScrollView =
      targetView.recursivelyFindParentView(whereType: UIScrollView.self);
      
    self.targetViewParentScrollView = targetViewParentScrollView;
    
    guard let auxiliaryPreviewMetadata =
            AuxiliaryPreviewMetadata(auxiliaryPreviewModalManager: self)
    else { return };
    
    self.auxiliaryPreviewMetadata = auxiliaryPreviewMetadata;
    
    let beginModalPresentation = {
      self.presentationState = .presenting;
      presentingController.present(presentedController, animated: true);
    };
    
    if let targetViewParentScrollView = targetViewParentScrollView,
       auxiliaryPreviewMetadata.offsetY != 0 {
      
      let animatorConfig: AnimationConfig =
        .presetCurve(duration: 0.2, curve: .easeInOut);
    
      let animator =
        animatorConfig.createAnimator(gestureInitialVelocity: .zero);
        
      animator.addAnimations {
        targetViewParentScrollView.contentOffset.y += auxiliaryPreviewMetadata.offsetY;
      };
      
      animator.addCompletion { _ in
        beginModalPresentation();
      };
      
      animator.startAnimation();
         
    } else {
      beginModalPresentation();
    };
  };
};
