//
//  ContextMenuManager.swift
//  
//
//  Created by Dominic Go on 10/7/23.
//

import UIKit
import DGSwiftUtilities

public class ContextMenuManager {

  static weak var auxiliaryPreview: UIView?;
  
  // MARK: - Properties
  // ------------------
  
  public var auxiliaryPreviewConfig: AuxiliaryPreviewConfig?;
  
  internal(set) public var auxiliaryPreviewMenuManager: AuxiliaryPreviewMenuManager? {
    willSet {
      guard let newValue = newValue else { return };
      
      self.attachAndAnimateAuxiliaryPreviewUsingCustomAnimator(
        usingAuxiliaryPreviewMenuManager: newValue
      );
    }
  };
  
  public var isAuxiliaryPreviewEnabled = true;
  internal(set) public var isContextMenuVisible = false;
  
  internal(set) public var auxiliaryPreviewView: UIView?;
  
  var auxiliaryPreviewModalManager: AuxiliaryPreviewModalManager?;
  var auxiliaryPreviewModalController: UIViewController?;
  
  // MARK: - Properties - References
  // -------------------------------
  
  public weak var delegate: ContextMenuManagerDelegate?;
  
  /// A reference to the view that contains the context menu interaction
  public weak var menuTargetView: UIView?;
  
  /// A reference to the `UIContextMenuInteraction` interaction config that
  /// the `targetView` is using
  public weak var contextMenuInteraction: UIContextMenuInteraction?;
  
  /// A reference to the view controller that contains the custom context menu
  /// preview that will be used when the menu is shown
  public weak var menuCustomPreviewController: UIViewController?;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  /// Gets the `_UIContextMenuContainerView` that's holding the context menu
  /// controls.
  ///
  /// **Note**: This `UIView` instance  only exists whenever there's a
  /// context menu interaction.
  ///
  public var contextMenuContainerViewWrapper: ContextMenuContainerViewWrapper? {
    guard let targetView = self.menuTargetView,
          let window = targetView.window
    else { return nil };
    
    return window.subviews.reduce(nil) { (prev, subview) in
      prev ?? ContextMenuContainerViewWrapper(objectToWrap: subview);
    };
  };
  
  public var isUsingCustomMenuPreview: Bool {
    self.menuCustomPreviewController != nil
  };

  public var isAuxiliaryPreviewMenuVisible: Bool {
    self.auxiliaryPreviewMenuManager?.isAuxiliaryPreviewVisible ?? false;
  };
  
  public var isAuxiliaryPreviewModalVisible: Bool {
    self.auxiliaryPreviewModalManager?.isPresenting ?? false;
  };
  
  public var isAuxiliaryPreviewVisible: Bool {
       self.isAuxiliaryPreviewMenuVisible
    || self.isAuxiliaryPreviewModalVisible;
  };
  
  // MARK: - Init
  // ------------
  
  public init(
    contextMenuInteraction: UIContextMenuInteraction?,
    menuTargetView: UIView?
  ) {
    self.contextMenuInteraction = contextMenuInteraction;
    self.menuTargetView = menuTargetView;
  };
  
  // MARK: - Functions
  // -----------------
  
  func attachAndAnimateAuxiliaryPreviewUsingCustomAnimator(
    usingAuxiliaryPreviewMenuManager manager: AuxiliaryPreviewMenuManager
  ){
    guard self.isAuxiliaryPreviewEnabled,
          self.auxiliaryPreviewView != nil,
          
          let auxiliaryPreviewConfig = self.auxiliaryPreviewConfig,
          case .customDelay = auxiliaryPreviewConfig.transitionConfigEntrance
    else { return };
    
    manager.attachAndAnimateInAuxiliaryPreviewUsingCustomAnimator();
  };
  
  // MARK: - Public Functions
  // ------------------------
  
  public func presentMenu(atLocation location: CGPoint) throws {
    guard let interaction = self.contextMenuInteraction else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "Ref. to `contextMenuInteraction` is nil"
      );
    };
    
    let interactionWrapper =
      ContextMenuInteractionWrapper(objectToWrap: interaction);
    
    guard let interactionWrapper = interactionWrapper else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "Unable to create `ContextMenuInteractionWrapper` instance"
      );
    };
    
    try? interactionWrapper.presentMenuAtLocation(point: .zero);
  };
  
  public func showAuxiliaryPreviewAsPopover(
    presentingViewController presentingController: UIViewController
  ) throws {
    guard !self.isAuxiliaryPreviewVisible else { return };
    
    guard let auxiliaryPreviewConfig = self.auxiliaryPreviewConfig else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "`auxiliaryPreviewConfig` is not set"
      );
    };
    
    guard let menuTargetView = self.menuTargetView else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "Ref. to `menuTargetView` is nil"
      );
    };
    
    guard menuTargetView.superview != nil || menuTargetView.window != nil else {
      throw AuxiliaryPreviewError(
        errorCode: .guardCheckFailed,
        description: "`menuTargetView` is not in the view hierarchy"
      );
    };
    
    guard let delegate = self.delegate else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "`delegate` is not set"
      );
    };
    
    guard let auxPreviewView = delegate.onRequestMenuAuxiliaryPreview(sender: self) else {
      throw AuxiliaryPreviewError(
        errorCode: .unexpectedNilValue,
        description: "`auxPreviewView` is nil"
      );
    };
    
    self.auxiliaryPreviewView = auxPreviewView;
    
    let modalVC: UIViewController = {
      let match = auxPreviewView.recursivelyGetAllParentResponders.first {
        $0 is UIViewController;
      };
      
      guard let associatedVC = match as? UIViewController else {
        return AuxiliaryPreviewModalViewController();
      };
      
      return associatedVC;
    }();
    
    self.auxiliaryPreviewModalController = modalVC;
    
    let modalManager = AuxiliaryPreviewModalManager(
      auxiliaryPreviewConfig: auxiliaryPreviewConfig
    );
    
    modalManager.delegate = self;
    self.auxiliaryPreviewModalManager = modalManager;
    
    modalManager.present(
      viewControllerToPresent: modalVC,
      presentingViewController: presentingController,
      targetView: menuTargetView
    );
  };
  
  // MARK: - Public Functions - UIContextMenuInteraction
  // ---------------------------------------------------
  
  public func notifyOnContextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) {
    // no-op
  };
  
  // context menu display begins
  public func notifyOnContextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
  
    self.isContextMenuVisible = true;
    
    guard self.isAuxiliaryPreviewEnabled,
          let auxiliaryPreviewConfig = self.auxiliaryPreviewConfig,
          let animator = animator,
          
          let delegate = self.delegate,
          let auxiliaryPreviewView =
            delegate.onRequestMenuAuxiliaryPreview(sender: self)
    else { return };
      
    self.auxiliaryPreviewView = auxiliaryPreviewView;
    
    if case .syncedToMenuEntranceTransition = auxiliaryPreviewConfig.transitionConfigEntrance {
      auxiliaryPreviewView.alpha = 0;
      
      let transformConfig = Transform3D(scaleX: 0.9, scaleY: 0.9);
      auxiliaryPreviewView.layer.transform = transformConfig.transform;
    };
      
    animator.addAnimations {
      let auxiliaryPreviewMenuManager = AuxiliaryPreviewMenuManager(
        usingContextMenuManager: self,
        contextMenuAnimator: animator
      );
      
      guard let auxiliaryPreviewMenuManager = auxiliaryPreviewMenuManager
      else { return };
      
      self.auxiliaryPreviewMenuManager = auxiliaryPreviewMenuManager;

      auxiliaryPreviewMenuManager.nudgeContextMenuIfNeeded();
      auxiliaryPreviewMenuManager.notifyOnMenuWillShow();
      
      guard case .syncedToMenuEntranceTransition =
              auxiliaryPreviewConfig.transitionConfigEntrance
      else { return };
      
      auxiliaryPreviewMenuManager
        .attachAndAnimateInAuxiliaryPreviewTogetherWithContextMenu();
    };
    
    animator.addCompletion {
      guard case .afterMenuEntranceTransition = auxiliaryPreviewConfig.transitionConfigEntrance,
            let auxiliaryPreviewMenuManager = self.auxiliaryPreviewMenuManager
      else { return };
      
      auxiliaryPreviewMenuManager
        .attachAndAnimateInAuxiliaryPreviewUsingCustomAnimator();
    };
    
    #if DEBUG
    animator.addCompletion {
      print("UIContextMenuInteractionAnimating - completion:");
      self.auxiliaryPreviewMenuManager?.debugPrintValues();
    };
    #endif
  };
  
  // context menu display ends
  public func notifyOnContextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
  
    guard self.isAuxiliaryPreviewEnabled,
          self.isAuxiliaryPreviewVisible,
    
          let animator = animator,
          let auxPreviewManager = self.auxiliaryPreviewMenuManager
    else { return };
    
    auxPreviewManager.notifyOnMenuWillHide();
    auxPreviewManager.detachAndAnimateOutAuxiliaryPreview(animator: animator);
    
    animator.addCompletion {
      self.isContextMenuVisible = false;
      self.auxiliaryPreviewMenuManager = nil;
      self.auxiliaryPreviewView = nil;
    };
  };
};
