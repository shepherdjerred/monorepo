//
//  ComputableLayoutValueContext.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 6/9/23.
//

import UIKit

public struct ComputableLayoutValueContext {

  public static let `default`: Self = .init(
    evaluableConditionContext: .default,
    targetRect: .zero,
    windowSize: nil,
    currentSize: nil,
    safeAreaInsets: nil,
    keyboardScreenRect: nil,
    keyboardRelativeSize: nil
  );
  
  public let evaluableConditionContext: EvaluableConditionContext;

  public let targetRect: CGRect;

  public let windowSize: CGSize?;
  public let currentSize: CGSize?;
  
  public let safeAreaInsets: UIEdgeInsets?;
  
  public let keyboardScreenRect: CGRect?;
  public let keyboardRelativeSize: CGSize?;
  
  public var targetSize: CGSize {
    self.targetRect.size;
  };
  
  public var screenSize: CGSize {
    UIScreen.main.bounds.size;
  };
};

// MARK: - Init
// ------------

public extension ComputableLayoutValueContext {

  init(
    derivedFrom prev: Self,
    targetView: UIView? = nil,
    targetRect: CGRect? = nil,
    windowSize: CGSize? = nil,
    currentSize: CGSize? = nil,
    safeAreaInsets: UIEdgeInsets? = nil,
    keyboardValues: ComputableLayoutKeyboardValues? = nil
  ) {
    
    self.targetRect  = targetRect  ?? prev.targetRect;
    self.windowSize  = windowSize  ?? prev.windowSize;
    self.currentSize = currentSize ?? prev.currentSize;
    
    self.safeAreaInsets = safeAreaInsets ?? prev.safeAreaInsets;
    self.keyboardScreenRect = keyboardValues?.frameEnd ?? prev.keyboardScreenRect;
    
    self.keyboardRelativeSize = {
      guard let targetView = targetView,
            let keyboardValues = keyboardValues
      else {
        return prev.keyboardRelativeSize;
      };
      
      let keyboardSize = keyboardValues.computeKeyboardSize(
        relativeToView: targetView
      );
      
      return keyboardSize ?? prev.keyboardRelativeSize;
    }();
    
    self.evaluableConditionContext = {
      let next = EvaluableConditionContext(
        window: targetView?.window,
        targetView: targetView
      );
      
      return .init(
        derivedFrom: next,
        withBase: prev.evaluableConditionContext
      );
    }();
  };
  
  init?(
    fromTargetViewController targetVC: UIViewController,
    keyboardValues: ComputableLayoutKeyboardValues? = nil,
    currentSize: CGSize? = nil
  ) {
    guard let targetView = targetVC.view else { return nil };
  
    self.targetRect = targetView.frame;
    self.windowSize = targetView.window?.bounds.size;
    
    self.safeAreaInsets = targetView.window?.safeAreaInsets;
    self.currentSize = currentSize;
    
    self.keyboardScreenRect = keyboardValues?.frameEnd;
    
    self.keyboardRelativeSize =
      keyboardValues?.computeKeyboardSize(relativeToView: targetView);
      
    self.evaluableConditionContext = .init(
      window: targetVC.view.window,
      targetView: targetVC.view
    );
  };
  
  init?(
    fromTargetView targetView: UIView,
    keyboardValues: ComputableLayoutKeyboardValues? = nil,
    currentSize: CGSize? = nil
  ) {
    self.targetRect = targetView.frame;
    self.windowSize = targetView.window?.bounds.size;
    
    self.safeAreaInsets = targetView.window?.safeAreaInsets;
    self.currentSize = currentSize;
    
    self.keyboardScreenRect = keyboardValues?.frameEnd;
    
    self.keyboardRelativeSize =
      keyboardValues?.computeKeyboardSize(relativeToView: targetView);
      
    self.evaluableConditionContext = .init(
      window: targetView.window,
      targetView: targetView
    );
  };
};
