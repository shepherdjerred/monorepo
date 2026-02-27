//
//  ViewKeyframeable.swift
//  Experiments-Misc
//
//  Created by Dominic Go on 11/13/24.
//

import UIKit


public class ShapeView: UIView {

  // MARK: - Embedded Types
  // ----------------------

  public enum AnimationState {
    case noAnimation;
    
    case pendingAnimation(
      animationBase: CABasicAnimation,
      pendingAnimations: [CABasicAnimation],
      currentFrame: CGRect,
      nextFrame: CGRect,
      currentPath: CGPath,
      nextPath: CGPath
    );
    
    case animating(
      animationBase: CABasicAnimation,
      currentAnimations: [CABasicAnimation],
      prevFrame: CGRect,
      nextFrame: CGRect,
      prevPath: CGPath,
      nextPath: CGPath
    );
    
    var isAboutToBeAnimated: Bool {
      switch self {
        case .pendingAnimation:
          return true;
          
        default:
          return false;
      };
    };
    
    var isAnimating: Bool {
      switch self {
        case .animating:
          return true;
          
        default:
          return false;
      };
    };
    
    public var isAnimatingOrAboutToBeAnimated: Bool {
      self.isAnimating || self.isAboutToBeAnimated;
    };
    
    public var isAnimatingFrame: Bool {
      switch self {
        case let .pendingAnimation(_, _, currentFrame, nextFrame, _, _):
          return currentFrame != nextFrame;
        
        case let .animating(_, _, currentFrame, nextFrame, _, _):
          return currentFrame != nextFrame;
          
        default:
          return false;
      };
    };
    
    public var animationBase: CABasicAnimation? {
      switch self {
        case let .pendingAnimation(animationBase, _, _, _, _, _):
          return animationBase;
        
        case let .animating(animationBase, _, _, _, _, _):
          return animationBase;
          
        default:
          return nil;
      };
    };
    
    mutating func appendAnimations(_ animations: [CABasicAnimation]){
      switch self {
        case let .pendingAnimation(
          animationBase,
          pendingAnimations,
          currentFrame,
          nextFrame,
          currentPath,
          nextPath
        ):
          self = .pendingAnimation(
            animationBase: animationBase,
            pendingAnimations: pendingAnimations + animations,
            currentFrame: currentFrame,
            nextFrame: nextFrame,
            currentPath: currentPath,
            nextPath: nextPath
          );
          
        default:
          #if DEBUG
          assertionFailure("can only append animations to `.pendingAnimation`");
          #endif
          break;
      };
    };
    
    mutating func appendAnimation(_ animation: CABasicAnimation){
      self.appendAnimations([animation]);
    };
  };
  
  // MARK: - Properties
  // ------------------
  
  private var _didSetupLayers = false;
  
  public var borderLayer: CAShapeLayer!;
  public var prevFrame: CGRect?;
  
  public var animationState: AnimationState = .noAnimation;
  public weak var rootAnimationSource: CALayer?;
  
  /// * When set to `true`, it means this view is part of some animation, and
  ///   will always try to find an animator before applying the configs.
  ///
  /// * When set to `false`, it means do not animate ever.
  ///
  ///
  public var isExplicitlyBeingAnimated: Bool?;
  
  // MARK: - Animatable Properties
  // -----------------------------
  
  public var maskShapeConfig: ShapePreset = .none {
    didSet {
      guard !self.isAnimating else {
        return;
      };
      
      let newValue = self.maskShapeConfig;
      guard newValue != oldValue else {
        return;
      };
      
      self.updateLayers();
    }
  };
  
  private var _borderStyleCurrent: ShapeLayerStrokeStyle = .noBorder;
  private var _borderStylePending: ShapeLayerStrokeStyle?;
  public var borderStyle: ShapeLayerStrokeStyle {
    get {
      if let pendingValue = self._borderStylePending {
        return pendingValue;
      };
      return self._borderStyleCurrent;
    }
    set {
      let oldValue = self.borderStyle;
      guard newValue != oldValue else {
        return;
      };
      
      self._borderStylePending = newValue;
      if !self.isAnimating {
        self.updateBorderLayer();
      };
    }
  };
  
  
  // TODO: Currently not impl. properly when used w/ animations
  private var _maskTransformCurrent: Transform3D?;
  private var _maskTransformPending: Transform3D?;
  public var maskTransform: Transform3D? {
    get {
      if let pendingValue = self._maskTransformPending {
        return pendingValue;
      };
      return self._maskTransformCurrent;
    }
    set {
      let oldValue = self.maskTransform;
      guard newValue != oldValue else {
        return;
      };
      
      self._maskTransformPending = newValue;
      if !self.isAnimating {
        self.updateMaskTransform();
      };
    }
  };
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var isAnimating: Bool {
    if let isExplicitlyBeingAnimated = self.isExplicitlyBeingAnimated {
      return isExplicitlyBeingAnimated;
    };
    
    if UIView.inheritedAnimationDuration > 0 {
      return true;
    };
    
    return false;
  };
  
  // MARK: - View Lifecycle
  // ----------------------
  
  public override func layoutSubviews() {
    self.setupLayersIfNeeded();
    
    super.layoutSubviews();
    self.updateLayers();
  };
  
  // MARK: - Methods (Private)
  // -------------------------
  
  private func setupLayersIfNeeded(){
    guard !self._didSetupLayers else {
      return;
    };
    
    // debug
    // self.layer.backgroundColor = UIColor.orange.cgColor
    
    self._didSetupLayers = true;
    // self.layer.masksToBounds = true;
  };
  
  private func setupBorderLayerIfNeeded(){
    guard self.borderLayer == nil else {
      return;
    };
    
    let borderLayer = CAShapeLayer();
    borderLayer.fillColor = nil;
    
    self.borderLayer = borderLayer;
    self.layer.insertSublayer(borderLayer, at: 0);
    borderLayer.zPosition = .greatestFiniteMagnitude;
  };
  
  private func updateLayers(){
    let animationStateCurrent = self.animationState;
    
    let animationBase: CABasicAnimation? = {
      if let animationBaseCurrent = animationStateCurrent.animationBase {
        return animationBaseCurrent;
      };
      
      if let isExplicitlyBeingAnimated = self.isExplicitlyBeingAnimated,
         !isExplicitlyBeingAnimated
      {
        return nil;
      };
      
      if let rootAnimationSource = self.rootAnimationSource {
        return rootAnimationSource.recursivelyFindChildAnimation(
          forType: CABasicAnimation.self,
          shouldSkipCurrentLayer: false
        );
      };
      
      return self.layer.closestBasicAnimation;
    }();
    
    let animationStateNext: AnimationState = {
      guard let animationBase = animationBase else {
        return .noAnimation;
      };
      
      switch animationStateCurrent {
        case .noAnimation:
          let nextFrame = self.bounds;
          defer {
            self.prevFrame = nextFrame;
          };
          
          let currentFrame =
               self.layer.presentation()?.bounds
            ?? self.prevFrame
            ?? .zero;
            
          guard let currentShapeMask = self.layer.mask as? CAShapeLayer else {
            return .noAnimation;
          };
          
          let currentShapeMaskPath =
               currentShapeMask.presentation()?.path
            ?? currentShapeMask.path!;
          
          let nextShapeMaskPath: CGPath = {
            let maskPath =
              self.maskShapeConfig.createPath(inRect: nextFrame);
              
            return maskPath.cgPath;
          }();
          
          return .pendingAnimation(
            animationBase: animationBase,
            pendingAnimations: [],
            currentFrame: currentFrame,
            nextFrame: nextFrame,
            currentPath: currentShapeMaskPath,
            nextPath: nextShapeMaskPath
          );
          
        case let .pendingAnimation(
          animationBase,
          pendingAnimations,
          currentFrame,
          nextFrame,
          currentPath,
          nextPath
        ):
          return .animating(
            animationBase: animationBase,
            currentAnimations: pendingAnimations,
            prevFrame: currentFrame,
            nextFrame: nextFrame,
            prevPath: currentPath,
            nextPath: nextPath
          );
          
        default:
          // no changes
          return animationStateCurrent;
      };
    }();
        
    self.animationState = animationStateNext;
    
    self.updateLayerMask();
    self.updateBorderLayer();
    self.updateMaskTransform();
    
    if !animationStateNext.isAnimatingOrAboutToBeAnimated {
      self.prevFrame = self.frame;
    };
  };
  
  private func updateLayerMask(){
    switch self.animationState {
      case .noAnimation:
        guard !self.bounds.isEmpty else {
          break;
        };
        
        let shapePathMask =
          self.maskShapeConfig.createPath(inRect: self.bounds);
        
        let maskShape = CAShapeLayer();
        maskShape.path = shapePathMask.cgPath;
        self.layer.mask = maskShape;
          
      case let .pendingAnimation(animationBase, _, _, _, currentPath, nextPath):
        let animationKey = #keyPath(CAShapeLayer.path);
        let currentShapeMask = self.layer.mask as! CAShapeLayer;
        
        guard currentShapeMask.animation(forKey: animationKey) == nil else {
          break;
        };
        
        let pathAnimation = animationBase.copy() as! CABasicAnimation;
        pathAnimation.keyPath = #keyPath(CAShapeLayer.path);
        
        pathAnimation.fromValue = currentPath;
        pathAnimation.toValue = nextPath;
        currentShapeMask.path = nextPath;
        
        pathAnimation.delegate = self;
        
        currentShapeMask.speed = 1;
        currentShapeMask.add(pathAnimation, forKey: animationKey);
        
        self.animationState.appendAnimations([pathAnimation]);
        
      case .animating:
        break;
    };
  };
  
  private func updateBorderLayer(){
    let borderStyleCurrent = self._borderStyleCurrent;
    
    let borderStylePending =
         self._borderStylePending
      ?? borderStyleCurrent;
        
    defer {
      self._borderStyleCurrent = borderStylePending;
      self._borderStylePending = nil;
    };
    
    
    switch self.animationState {
      case .noAnimation:
        self.setupBorderLayerIfNeeded();
        
        guard !self.bounds.isEmpty else {
          return;
        };
        
        let maskShape = self.layer.mask as! CAShapeLayer;
        self.borderLayer.path = maskShape.path;
        borderStylePending.apply(toShape: self.borderLayer);
        
      case let .pendingAnimation(animationBase, _, _, _, currentPath, nextPath):
        let pathAnimation: CABasicAnimation? = {
          let animationKey = #keyPath(CAShapeLayer.path);
          
          guard self.borderLayer.animation(forKey: animationKey) == nil else {
            return nil;
          };
          
          let animation = animationBase.copy() as! CABasicAnimation;
          animation.keyPath = animationKey;
          animation.fromValue = currentPath;
          animation.toValue = nextPath;
          
          animation.delegate = self;
          
          self.borderLayer.speed = 1;
          self.borderLayer.add(animation, forKey: animationKey);
          self.borderLayer.path = nextPath;
          
          return animation;
        }();
      
        var animations: [CABasicAnimation] = [];
        animations.unwrapThenAppend(pathAnimation);
        
        animations += borderStylePending.createAnimations(
          forShape: self.borderLayer,
          withPrevStyle: borderStyleCurrent,
          usingBaseAnimation: animationBase
        );
        
        self.animationState.appendAnimations(animations);
        
      case .animating:
        break;
    };
  };
  
  private func updateMaskTransform(){
    let maskTransformCurrent = self._maskTransformCurrent;
    
    let maskTransformPending =
         self._maskTransformPending
      ?? maskTransformCurrent
      ?? .identity;
        
    defer {
      self._maskTransformCurrent = maskTransformPending;
      self._maskTransformPending = nil;
    };

    switch self.animationState {
      case .noAnimation:
        guard !self.bounds.isEmpty else {
          return;
        };
        
        let transform = maskTransformPending.transform3D;
        self.layer.mask?.transform = transform;
        self.borderLayer?.transform = transform;
        
      case let .pendingAnimation(animationBase, _, _, _, _, _):
        let animationKey = #keyPath(CAShapeLayer.transform);
        let transformNext = maskTransformPending.transform3D;
        
        let animationLayerMaskTransform: CABasicAnimation? = {
          guard let maskLayer = self.layer.mask,
                maskLayer.animation(forKey: animationKey) == nil
          else {
            return nil;
          };
          
          let transformPrev =
               maskTransformCurrent?.transform3D
            ?? maskLayer.transform;
          
          let animation = animationBase.copy() as! CABasicAnimation;
          animation.keyPath = animationKey;
          animation.fromValue = transformPrev;
          animation.toValue = transformNext;
          
          animation.delegate = self;
          
          maskLayer.speed = 1;
          maskLayer.add(animation, forKey: animationKey);
          maskLayer.transform = transformNext;
          
          return animation;
        }();
        
        let animationBorderLayerTransform: CABasicAnimation? = {
          guard let borderLayer = self.borderLayer,
                borderLayer.animation(forKey: animationKey) == nil
          else {
            return nil;
          };
          
          let transformPrev =
               maskTransformCurrent?.transform3D
            ?? borderLayer.transform;
          
          let animation = animationBase.copy() as! CABasicAnimation;
          animation.keyPath = animationKey;
          animation.fromValue = transformPrev;
          animation.toValue = transformNext;
          
          animation.delegate = self;
          
          borderLayer.speed = 1;
          borderLayer.add(animation, forKey: animationKey);
          borderLayer.transform = transformNext;
          
          return animation;
        }();
      
        var animations: [CABasicAnimation] = [];
        animations.unwrapThenAppend(animationLayerMaskTransform);
        animations.unwrapThenAppend(animationBorderLayerTransform);

        self.animationState.appendAnimations(animations);
        
      case .animating:
        break;
    };
  };
  
  #if DEBUG
  public func debugLogViewInfo(
    funcName: String = #function
  ){
    let animationBgColor = self.layer.recursivelyFindParentAnimation(
      forKey: #keyPath(CALayer.backgroundColor),
      shouldSkipCurrentLayer: false,
      forType: CABasicAnimation.self
    );
    
    let animationSize = self.layer.recursivelyFindParentAnimation(
      forKey: "bounds.size",
      shouldSkipCurrentLayer: false,
      forType: CABasicAnimation.self
    );
    
    let animationPosition = self.layer.recursivelyFindParentAnimation(
      forKey: #keyPath(CALayer.position),
      shouldSkipCurrentLayer: false,
      forType: CABasicAnimation.self
    );
  
    print(
      "VariadicCornerRadiusView.\(funcName)",
      "\n - frame:", self.frame,
      "\n - bounds:", self.bounds,
      "\n - layer.frame:", self.layer.frame,
      "\n - layer.bounds:", self.layer.bounds,
      "\n - layer.position:", self.layer.position,
      "\n - layer.presentation.frame:", layer.presentation()?.frame.debugDescription ?? "N/A",
      "\n - layer.presentation.bounds:", layer.presentation()?.bounds.debugDescription ?? "N/A",
      "\n - layer.presentation.position:", layer.presentation()?.position.debugDescription ?? "N/A",
      "\n - layer.superlayer:", self.layer.superlayer?.debugDescription ?? "N/A",
      "\n - layer:", self.layer.debugDescription,
      "\n - animationBgColor:", animationBgColor?.debugDescription ?? "N/A",
      "\n - animationSize:", animationSize?.debugDescription ?? "N/A",
      "\n - animationPosition:", animationPosition?.debugDescription ?? "N/A",
      "\n - layer.actions.count:", self.layer.actions?.count ?? -1,
      "\n - inheritedAnimationDuration:", UIView.inheritedAnimationDuration,
      "\n - CATransaction.animationDuration:", CATransaction.animationDuration(),
      "\n - currentAnimations:", self.layer.animations,
      "\n - all child animations:", self.layer.recursivelyGetAllChildAnimations(shouldSkipCurrentLayer: true),
      "\n - all parent animations:", self.layer.recursivelyGetAllParentAnimations(shouldSkipCurrentLayer: true),
      "\n"
    );
  };
  #endif
  
  // MARK: - Methods (Public)
  // ------------------------
  
  public func prepareForAnimation(){
    self.clearAnimations();
    self.isExplicitlyBeingAnimated = true;
  };
  
  public func clearAnimations(){
    if self.isExplicitlyBeingAnimated == true {
      self.isExplicitlyBeingAnimated = nil;
    };
    
    self.animationState = .noAnimation;
  };
};

// MARK: - ViewKeyframeable+CAAnimationDelegate
// --------------------------------------------

extension ShapeView: CAAnimationDelegate {
  
  public func animationDidStart(_ anim: CAAnimation) {
    switch self.animationState {
      case let .pendingAnimation(
        animationBase,
        pendingAnimations,
        currentFrame,
        nextFrame,
        currentPath,
        nextPath
      ):
        self.animationState = .animating(
          animationBase: animationBase,
          currentAnimations: pendingAnimations,
          prevFrame: currentFrame,
          nextFrame: nextFrame,
          prevPath: currentPath,
          nextPath: nextPath
        );
      
      default:
        break;
    };
  };
  
  public func animationDidStop(_ anim: CAAnimation, finished flag: Bool) {
    self.clearAnimations();
  };
};
