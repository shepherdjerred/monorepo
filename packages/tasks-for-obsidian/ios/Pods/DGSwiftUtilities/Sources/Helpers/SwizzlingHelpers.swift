//
//  SwizzlingHelpers.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import UIKit


public class SwizzlingHelpers {

  public static func swizzleExchangeMethods(
    defaultSelector: Selector,
    newSelector: Selector,
    forClass class: AnyClass
  ) {
    let defaultInstace =
      class_getInstanceMethod(`class`.self, defaultSelector);
    
    let newInstance =
      class_getInstanceMethod(`class`.self, newSelector);
    
    guard let defaultInstance = defaultInstace,
          let newInstance = newInstance
    else { return };
          
    method_exchangeImplementations(defaultInstance, newInstance);
  };
  
  @discardableResult
  public static func swizzleWithBlock<T>(
    impMethodType: T.Type,
    forClass `class`: AnyClass,
    withSelector selector: Selector,
    newImpMaker: @escaping (
      _ originalImp: T,
      _ selector: Selector
    ) -> Any
  ) -> IMP? {
  
    // Retrieve the class method/IMP that matches the selector for the
    // given type.
    let originalMethod = class_getInstanceMethod(`class`, selector);
    guard let originalMethod = originalMethod else { return nil };
    
    /// An `IMP` is just a C function pointer where the first two args are
    /// `self` and `_cmd`.
    let originalImp = method_getImplementation(originalMethod);
    let originalImpFunc = unsafeBitCast(originalImp, to: T.self);
    
    let newImpBlock = newImpMaker(originalImpFunc, selector);
    let newImp = imp_implementationWithBlock(newImpBlock);

    // Swizzle - Replace `originalImpFunc` w/ `newImp`
    return method_setImplementation(originalMethod, newImp);
  };

  @discardableResult
  public static func swizzleWithBlock<T>(
    impMethodType: T.Type,
    forObject object: AnyObject,
    withSelector selector: Selector,
    newImpMaker: @escaping (
      _ originalImp: T,
      _ selector: Selector
    ) -> Any
  ) -> IMP? {
  
    // Retrieve the class method/IMP that matches the selector for the
    // given type.
    let originalMethod = class_getInstanceMethod(type(of: object), selector);
    guard let originalMethod = originalMethod else { return nil };
    
    /// An `IMP` is just a C function pointer where the first two args are
    /// `self` and `_cmd`.
    let originalImp = method_getImplementation(originalMethod);
    let originalImpFunc = unsafeBitCast(originalImp, to: T.self);
    
    let newImpBlock = newImpMaker(originalImpFunc, selector);
    let newImp = imp_implementationWithBlock(newImpBlock);

    // Swizzle - Replace `originalImpFunc` w/ `newImp`
    return method_setImplementation(originalMethod, newImp);
  };

  @discardableResult
  public static func swizzleHitTest<T, U>(
    /// `UIView.hitTest(_:with:)` or:
    /// `func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView?`
    ///
    impMethodType: T.Type =
      (@convention(c) (Any, Selector, CGPoint, UIEvent?) -> UIView?).self,
      
    impBlockType: U.Type =
      (@convention(block) (Any, CGPoint, UIEvent?) -> UIView?).self,
      
    forView view: UIView,
    hitTestBlockMaker: @escaping (
      _ originalImp: T,
      _ selector: Selector
    ) -> U
  ) -> IMP? {
    let selector = #selector(UIView.hitTest(_:with:));
    
    return Self.swizzleWithBlock(
      impMethodType: impMethodType,
      forObject: view,
      withSelector: selector,
      newImpMaker: hitTestBlockMaker
    );
  };
  
  @discardableResult
  public static func swizzleHitTest<T, U>(
    /// `UIView.hitTest(_:with:)` or:
    /// `func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView?`
    ///
    impMethodType: T.Type =
      (@convention(c) (Any, Selector, CGPoint, UIEvent?) -> UIView?).self,
      
    impBlockType: U.Type =
      (@convention(block) (Any, CGPoint, UIEvent?) -> UIView?).self,
      
    forClass `class`: AnyClass,
    hitTestBlockMaker: @escaping (
      _ originalImp: T,
      _ selector: Selector
    ) -> U
  ) -> IMP? {
    let selector = #selector(UIView.hitTest(_:with:));
    
    return Self.swizzleWithBlock(
      impMethodType: impMethodType,
      forClass: `class`,
      withSelector: selector,
      newImpMaker: hitTestBlockMaker
    );
  };
};
