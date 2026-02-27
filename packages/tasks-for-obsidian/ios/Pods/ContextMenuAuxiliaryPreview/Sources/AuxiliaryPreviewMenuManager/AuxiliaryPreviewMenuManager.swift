//
//  AuxiliaryPreviewMenuManager.swift
//  
//
//  Created by Dominic Go on 10/9/23.
//

import UIKit
import DGSwiftUtilities

/// This class contains the logic for attaching the "context menu aux. preview"
/// to the context menu
///
public class AuxiliaryPreviewMenuManager {

  // MARK: - Properties
  // ------------------
  
  lazy var auxiliaryPreviewMetadata: AuxiliaryPreviewMetadata? = .init(
    auxiliaryPreviewMenuManager: self
  );

  var contextMenuMetadata: ContextMenuMetadata;
  var customAnimator: UIViewPropertyAnimator?;
  
  var isAuxiliaryPreviewVisible = false;
  
  /// Contains all the "context menu"-related views
  var contextMenuViews: AuxiliaryPreviewViewProvider;
  
  // MARK: - Properties - References
  // -------------------------------
  
  weak var window: UIWindow?;
  
  weak var contextMenuManager: ContextMenuManager?;
  weak var contextMenuAnimator: UIContextMenuInteractionAnimating?;
  
  /// this is where the "aux. preview" view will be attached to
  weak var auxiliaryPreviewParentView: UIView?;
  
  weak var auxiliaryPreviewWidthConstraint: NSLayoutConstraint?;
  weak var auxiliaryPreviewHeightConstraint: NSLayoutConstraint?;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  var auxiliaryPreviewView: UIView? {
    self.contextMenuManager?.auxiliaryPreviewView;
  };
  
  // MARK: - Init
  // ------------
  
  public init?(
    usingContextMenuManager manager: ContextMenuManager,
    contextMenuAnimator animator: UIContextMenuInteractionAnimating
  ) {
  
    self.contextMenuManager = manager;
    self.contextMenuAnimator = animator;
              
    let contextMenuViews: AuxiliaryPreviewViewProvider? = {
      if #available(iOS 16, *) {
        return ContextMenuViewExtractorForIOS16(usingManager: manager);
      };
      
      if #available(iOS 15, *) {
        return ContextMenuViewExtractorForIOS15(usingManager: manager);
      };
      
      if #available(iOS 13, *) {
        return ContextMenuViewExtractorForIOS13(usingManager: manager);
      };
      
      return nil;
    }();
    
    guard let contextMenuViews = contextMenuViews,
          let contextMenuWindowRootView = contextMenuViews.contextMenuWindowRootView,
          let contextMenuPreviewRootView = contextMenuViews.contextMenuPreviewRootView,
          
          let window = contextMenuWindowRootView.window
    else { return nil };
    
    self.contextMenuViews = contextMenuViews;
    self.window = window;

    // MARK: Prep - Set Constants
    // --------------------------
    
    let isUsingCustomPreview = animator.previewViewController != nil;

    // where should the aux. preview be attached to?
    self.auxiliaryPreviewParentView = isUsingCustomPreview
      ? contextMenuWindowRootView
      : contextMenuPreviewRootView;
    
    // MARK: Prep - Determine Size and Position
    // ----------------------------------------
    
    let menuItemsPlacement: VerticalAnchorPosition? = {
      guard contextMenuViews.hasMenuItems,
            let contextMenuListRootView = contextMenuViews.contextMenuListRootView
      else { return nil };
      
      let previewFrame = contextMenuPreviewRootView.frame;
      let menuItemsFrame = contextMenuListRootView.frame;
      
      return (menuItemsFrame.midY > previewFrame.midY) ? .bottom : .top;
    }();
    
    let morphingPlatterViewPlacement: VerticalAnchorPosition = {
      let previewFrame = contextMenuPreviewRootView.frame;
      let screenBounds = UIScreen.main.bounds;

      return (previewFrame.midY < screenBounds.midY) ? .top : .bottom;
    }();
    
    self.contextMenuMetadata = .init(
      rootContainerFrame: contextMenuWindowRootView.frame,
      menuPreviewFrame: contextMenuPreviewRootView.frame,
      menuFrame: contextMenuViews.contextMenuListRootView?.frame,
      menuPreviewPosition: morphingPlatterViewPlacement,
      menuPosition: menuItemsPlacement
    );
  };

  // MARK: - Functions
  // -----------------
  
  func attachAuxiliaryPreview(){
    guard let manager = self.contextMenuManager,
          let auxiliaryPreviewConfig = manager.auxiliaryPreviewConfig,
          let auxiliaryPreviewMetadata = self.auxiliaryPreviewMetadata,
          
          let auxiliaryPreviewView = manager.auxiliaryPreviewView,
          let auxiliaryPreviewParentView = self.auxiliaryPreviewParentView,
          
          let contextMenuWindowRootView =
            self.contextMenuViews.contextMenuWindowRootView
    else { return };

    // Bugfix: Stop bubbling touch events from propagating to parent
    auxiliaryPreviewView.addGestureRecognizer(
      UITapGestureRecognizer(target: nil, action: nil)
    );
    
    let keyframeStart: AuxiliaryPreviewTransitionKeyframe? = {
      guard let transitionAnimationConfig = auxiliaryPreviewConfig
              .transitionConfigEntrance.transitionAnimationConfig
      else { return nil };
      
      let keyframes = transitionAnimationConfig.transition.getKeyframes(
        auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
      );
        
      return keyframes.keyframeStart;
    }();
    
    let auxiliaryPreviewViewHeight: CGFloat = {
      guard let keyframeStart = keyframeStart,
            let height = keyframeStart.auxiliaryPreviewPreferredHeight
      else {
        return auxiliaryPreviewMetadata.computedHeight;
      };
      
      return height;
    }();
    
    let auxiliaryPreviewViewWidth = {
      guard let keyframeStart = keyframeStart,
            let width = keyframeStart.auxiliaryPreviewPreferredWidth
      else {
        return auxiliaryPreviewMetadata.computedWidthAdjusted;
      };
      
      return width;
    }();
    
    /// enable auto layout
    auxiliaryPreviewView.translatesAutoresizingMaskIntoConstraints = false;
    
    /// attach `auxiliaryView` to context menu preview
    auxiliaryPreviewParentView.addSubview(auxiliaryPreviewView);
    
    // get layout constraints based on config
    let constraints: [NSLayoutConstraint] = {
      var constraints: [NSLayoutConstraint] = [];
    
      // set aux preview height
      constraints.append({
        let heightConstraint = auxiliaryPreviewView.heightAnchor.constraint(
          equalToConstant: auxiliaryPreviewViewHeight
        );
        
        return heightConstraint;
      }());
      
      // set vertical alignment constraint
      constraints.append(
        auxiliaryPreviewMetadata.verticalAnchorPosition.createVerticalConstraints(
          forView: auxiliaryPreviewView,
          attachingTo: auxiliaryPreviewParentView,
          margin: auxiliaryPreviewConfig.marginInner
        )
      );
      
      // set horizontal alignment constraints based on config...
      constraints += {
        let horizontalAlignment = auxiliaryPreviewConfig.horizontalAlignment;
        
        let constraints = horizontalAlignment.createHorizontalConstraints(
          forView: auxiliaryPreviewView,
          attachingTo: auxiliaryPreviewParentView,
          enclosingView: contextMenuWindowRootView,
          preferredWidth: auxiliaryPreviewViewWidth,
          shouldPreferWidthAnchor: horizontalAlignment == .stretch
        );
        
        self.auxiliaryPreviewWidthConstraint = constraints.first {
          $0.firstAttribute == .width;
        };
        
        return constraints;
      }();
      
      return constraints;
    }();
    
    NSLayoutConstraint.activate(constraints);
    self.isAuxiliaryPreviewVisible = true;
  };
  
  func nudgeContextMenuIfNeeded(){
    guard let auxiliaryPreviewMetadata = self.auxiliaryPreviewMetadata,
          auxiliaryPreviewMetadata.offsetY != 0,
    
          let contextMenuSharedRootView =
            self.contextMenuViews.contextMenuSharedRootView
    else { return };
    
    contextMenuSharedRootView.frame = {
      let initFrame = contextMenuSharedRootView.frame;
      
      return initFrame.offsetBy(
        dx: 0,
        dy: auxiliaryPreviewMetadata.offsetY
      );
    }();
  };
  
  // TODO: WIP - TEMP
  func swizzleViews(){
    guard !UIView.isSwizzlingApplied,
          let manager = self.contextMenuManager,
          let auxiliaryPreviewView = manager.auxiliaryPreviewView
    else { return };
  
    UIView.auxPreview = auxiliaryPreviewView;
    UIView.swizzlePoint();
  };
  
  // TODO: WIP - TEMP
  func unSwizzleViews(){
    guard UIView.isSwizzlingApplied else { return };

    // undo swizzling
    UIView.swizzlePoint();
    UIView.auxPreview = nil;
  };
  
  func debugPrintValues(){
    print(
      "debugPrintValues:",
      "\n- menuPreviewPosition:", self.contextMenuMetadata.menuPreviewPosition.rawValue,
      "\n- menuPosition:", self.contextMenuMetadata.menuPosition?.rawValue ?? "N/A",
      "\n"
    );
  };
  
  func _debugPrintContextMenuViews(){
    guard let contextMenuSharedRootView = self.contextMenuViews.contextMenuSharedRootView
    else { return };
    
    let subviews = contextMenuSharedRootView.recursivelyGetAllSubviews;
    
    print(
      "contextMenuContainerView.recursivelyGetAllSubviews",
      "\n - count:", subviews.count,
      "\n - items::", subviews,
      "\n"
    );
    
    subviews.enumerated().forEach {
      print(
        "contextMenuContainerView.recursivelyGetAllSubviews items:",
        "\n - item \($0.offset) of \(subviews.count - 1)",
        "\n - className:", $0.element.className,
        "\n - frame:", $0.element.frame,
        "\n - bounds:", $0.element.bounds,
        "\n - gestureRecognizers count:", $0.element.gestureRecognizers?.count ?? -1,
        "\n - isUserInteractionEnabled:", $0.element.isUserInteractionEnabled,
        "\n - constraints count:", $0.element.constraints.count,
        "\n - subviews: count:", $0.element.subviews.count,
        "\n - recursivelyGetAllSuperviews count:", $0.element.recursivelyGetAllSuperviews.count,
        "\n - gestureRecognizers:", $0.element.gestureRecognizers ?? [],
        "\n - constraints:", $0.element.constraints,
        "\n"
      );
    };
  };
  
  // MARK: - Public Functions
  // ------------------------
  
  public func notifyOnMenuWillShow() {
    guard self.auxiliaryPreviewMetadata != nil else { return };
    self.swizzleViews();
  };
  
  public func notifyOnMenuWillHide(){
    guard self.auxiliaryPreviewMetadata != nil,
          self.isAuxiliaryPreviewVisible
    else { return };
    
    self.unSwizzleViews();
    self.isAuxiliaryPreviewVisible = false;
  };
  
  public func attachAndAnimateInAuxiliaryPreviewTogetherWithContextMenu() {
    guard let manager = self.contextMenuManager,
          let auxiliaryPreviewConfig = manager.auxiliaryPreviewConfig,
          let auxiliaryPreviewView = self.auxiliaryPreviewView,
          
          case let .syncedToMenuEntranceTransition(shouldAnimateSize) =
            auxiliaryPreviewConfig.transitionConfigEntrance
    else { return };
    
    auxiliaryPreviewView.transform = .identity;
    auxiliaryPreviewView.updateConstraints();
    
    auxiliaryPreviewView.alpha = 1;
    self.attachAuxiliaryPreview();
    
    if shouldAnimateSize {
      auxiliaryPreviewView.layoutIfNeeded();
    };
  };
  
  public func attachAndAnimateInAuxiliaryPreviewUsingCustomAnimator() {
    guard let auxiliaryPreviewMetadata = self.auxiliaryPreviewMetadata,
          let manager = self.contextMenuManager,
          
          let auxiliaryPreviewConfig = manager.auxiliaryPreviewConfig,
          let auxiliaryPreviewView = manager.auxiliaryPreviewView
    else { return };
    
    let transitionConfigEntrance =
      auxiliaryPreviewConfig.transitionConfigEntrance;
    
    guard let transitionAnimationConfig =
            transitionConfigEntrance.transitionAnimationConfig
    else { return };
    
    self.attachAuxiliaryPreview();
    auxiliaryPreviewView.layoutIfNeeded();
    
    let animator = transitionAnimationConfig.animatorConfig.createAnimator(
      gestureInitialVelocity: .zero
    );
    
    self.customAnimator = animator;
    let keyframes = transitionAnimationConfig.transition.getKeyframes(
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    keyframes.keyframeStart.apply(
      auxiliaryPreviewView: auxiliaryPreviewView,
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    animator.addAnimations {
      keyframes.keyframeEnd.apply(
        auxiliaryPreviewView: auxiliaryPreviewView,
        auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
      );
      
      auxiliaryPreviewView.layoutIfNeeded();
    };
    
    animator.startAnimation(
      afterDelay: transitionAnimationConfig.delay
    );
  };
  
  public func detachAndAnimateOutAuxiliaryPreview(
    animator: UIContextMenuInteractionAnimating
  ) {
    guard let auxiliaryPreviewMetadata = self.auxiliaryPreviewMetadata,
          let manager = self.contextMenuManager,
          
          let auxiliaryPreviewConfig = manager.auxiliaryPreviewConfig,
          let auxiliaryPreviewView = manager.auxiliaryPreviewView
    else { return };
    
    let keyframes = auxiliaryPreviewConfig.transitionConfigExit.getKeyframes(
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    if let customAnimator = self.customAnimator,
       customAnimator.isRunning {
       
      customAnimator.stopAnimation(true);
    };
    
    animator.addAnimations {
      keyframes.keyframeEnd.apply(
        auxiliaryPreviewView: auxiliaryPreviewView,
        auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
      );
      
      auxiliaryPreviewView.layoutIfNeeded();
    };
  };
};

// Bugfix: Fix for aux-preview not receiving touch event when appearing
// on screen edge
fileprivate extension UIView {
  static weak var auxPreview: UIView? = nil;
  
  static var isSwizzlingApplied = false
  
  @objc dynamic func _point(
    inside point: CGPoint,
    with event: UIEvent?
  ) -> Bool {
    
  
    guard let auxPreview = Self.auxPreview else {
      // call original impl.
      return self._point(inside: point, with: event);
    };
    
    let isPointInsideFrameOfAuxPreview: Bool = {
      guard let window = auxPreview.window else { return false };
    
      let auxPreviewFrameAdj = auxPreview.convert(auxPreview.bounds, to: window);
      let pointAdj = self.convert(point, to: window);
    
      return auxPreviewFrameAdj.contains(pointAdj);
    }();
    
    let isParentOfAuxPreview = self.subviews.contains {
      $0 === auxPreview;
    };

    guard isParentOfAuxPreview && isPointInsideFrameOfAuxPreview else {
      // call original impl.
      return self._point(inside: point, with: event);
    };
    
    return true;
  };
  
  static func swizzlePoint(){
    let selectorOriginal = #selector( point(inside: with:));
    let selectorSwizzled = #selector(_point(inside: with:));
    
    guard let methodOriginal = class_getInstanceMethod(UIView.self, selectorOriginal),
          let methodSwizzled = class_getInstanceMethod(UIView.self, selectorSwizzled)
    else { return };
    
    Self.isSwizzlingApplied.toggle();
    method_exchangeImplementations(methodOriginal, methodSwizzled);
  };
};
