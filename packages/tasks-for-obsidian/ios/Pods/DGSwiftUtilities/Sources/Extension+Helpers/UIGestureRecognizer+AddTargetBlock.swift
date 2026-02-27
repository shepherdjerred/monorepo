//
//  UIGestureRecognizer+Helpers.swift
//  
//
//  Created by Dominic Go on 6/16/24.
//

import UIKit

public extension UIGestureRecognizer {

  // MARK: - Public Embedded Types
  // -----------------------------

  typealias ActionHandler = (_ sender: UIGestureRecognizer) -> Void;
  
  // MARK: - Private Embedded Types
  // ------------------------------
  
  private typealias ActionHandlerMap = [String: ActionHandler];

  private enum PropertyKeys: String {
    case handlerList;
    case didAddTarget;
  };
  
  // MARK: - Private Properties
  // --------------------------
  
  private var didAddTarget: Bool {
    get {
      self.getInjectedValue(
        keys: PropertyKeys.self,
        forKey: .didAddTarget,
        fallbackValue: false
      );
    }
    set {
      self.setInjectedValue(
        keys: PropertyKeys.self,
        forKey: .didAddTarget,
        value: newValue
      );
    }
  };
  
  private var actionHandlerMap: ActionHandlerMap {
    get {
      self.getInjectedValue(
        keys: PropertyKeys.self,
        forKey: .handlerList,
        fallbackValue: [:]
      );
    }
    set {
      self.setInjectedValue(
        keys: PropertyKeys.self,
        forKey: .handlerList,
        value: newValue
      );
    }
  };
  
  // MARK: - Public Methods
  // ----------------------
  
  @discardableResult
  func addAction(action: @escaping ActionHandler) -> (() -> Void) {
    let handle = arc4random().description;
    self._addActionHandler(
      forKey: handle,
      actionHandler: action
    );
    
    let selector = #selector(Self._handleGestureRecognizerAction(_:));
    
    self.addTarget(self, action: selector);
    if !self.didAddTarget {
      
      self.didAddTarget = true;
    };
    
    //DeinitializationObserver();
    
    return {
      self._removeActionHandler(forKey: handle);
      guard self.didAddTarget else { return };
      
      self.removeTarget(self, action: selector);
      self.didAddTarget = false;
    };
  };
  
  // MARK: - Private Functions
  // -------------------------
  
  private func _addActionHandler(
    forKey key: String,
    actionHandler: @escaping ActionHandler
  ){
    var actionHandlerMap = self.actionHandlerMap;
    actionHandlerMap[key] = actionHandler;
    self.actionHandlerMap = actionHandlerMap;
  };
  
  private func _removeActionHandler(forKey key: String){
    var actionHandlerMap = self.actionHandlerMap;
    actionHandlerMap.removeValue(forKey: key);
    self.actionHandlerMap = actionHandlerMap;
  };
  
  @objc
  private func _handleGestureRecognizerAction(_ sender: UIGestureRecognizer){
    self.actionHandlerMap.forEach {
      $0.value(sender);
    };
  };
};

