import UIKit


public extension UIView {

  // MARK: - Computed Properties
  // ---------------------------

  var parentViewController: UIViewController? {
    var parentResponder: UIResponder? = self;
    
    while parentResponder != nil {
      parentResponder = parentResponder!.next
      if let viewController = parentResponder as? UIViewController {
        return viewController;
      };
    };
    
    return nil;
  };
  
  var rootViewControllerForCurrentWindow: UIViewController? {
    self.window?.rootViewController;
  };

  var rootViewForCurrentWindow: UIView? {
    self.rootViewControllerForCurrentWindow?.view;
  };
  
  var recursivelyGetAllSuperviews: [UIView] {
    var parentViews: [UIView] = [];
    var currentView = self;
    
    while true {
      guard let superview = currentView.superview else { return parentViews };
      parentViews.append(superview);
      currentView = superview;
    };
  };
  
  var recursivelyGetAllSubviews: [UIView] {
    var views: [UIView] = [];
    
    for subview in self.subviews {
      views.append(subview);
      views += subview.recursivelyGetAllSubviews;
    };
    
    return views;
  };
  
  var recursivelyGetAllGestureRecognizersFromSubviews: [UIGestureRecognizer] {
    self.recursivelyGetAllSubviews.reduce(into: []){
      $0 += $1.gestureRecognizers ?? []
    };
  };
  
  var recursivelyGetAllGestureRecognizers: [UIGestureRecognizer] {
    (self.gestureRecognizers ?? []) +
      self.recursivelyGetAllGestureRecognizersFromSubviews
  };
  
  var recursivelyGetAllParentResponders: [UIResponder] {
    var parentResponders: [UIResponder] = [self];
    
    while let currentParentResponder = parentResponders.last,
          let nextParentResponder = currentParentResponder.next {
      
      parentResponders.append(nextParentResponder);
    };
    
    return parentResponders;
  };
  
  var globalFrame: CGRect? {
    guard let superview = self.superview else { return nil };
    let absoluteOrigin = superview.convert(self.frame.origin, to: nil);
    
    return .init(
      origin: absoluteOrigin,
      size: self.frame.size
    );
  };
    
  var heightConstraint: NSLayoutConstraint? {
    self.constraints.first {
      $0.firstAttribute == .height
    };
  };
  
  var widthConstraint: NSLayoutConstraint? {
    self.constraints.first {
      $0.firstAttribute == .width
    };
  };
  
  // MARK: - Functions
  // -----------------
  
  /// Remove all ancestor constraints that are affecting this view instance
  ///
  /// Note: 2023-03-24-00-39-51
  ///
  /// * From: https://stackoverflow.com/questions/24418884/remove-all-constraints-affecting-a-uiview
  ///
  /// * After it's done executing, your view remains where it was because it
  ///   creates autoresizing constraints.
  ///
  /// * When I don't do this the view usually disappears.
  ///
  /// * Additionally, it doesn't just remove constraints from it's superview,
  ///   but in addition, it also climbs the view hierarchy, and removes all the
  ///   constraints affecting the current view instance that came from an
  ///   ancestor view.
  ///
  func removeAllAncestorConstraints() {
    var ancestorView = self.superview;
    
    // Climb the view hierarchy until there are no more parent views...
    while ancestorView != nil {
      for ancestorConstraint in ancestorView!.constraints {
        
        let constraintItems = [
          ancestorConstraint.firstItem,
          ancestorConstraint.secondItem
        ];
        
        constraintItems.forEach {
          guard ($0 as? UIView) === self else { return };
          ancestorView?.removeConstraint(ancestorConstraint);
        };
        
        ancestorView = ancestorView?.superview;
      };
    };
    
    self.removeConstraints(self.constraints);
    self.translatesAutoresizingMaskIntoConstraints = true
  };
  
  func recursivelyFindParentView(where predicate: (UIView) -> Bool) -> UIView? {
    var currentView = self;
    
    while true {
      if currentView !== self && predicate(currentView) {
        return currentView;
      };

      guard let superview = currentView.superview else { return nil };
      currentView = superview;
    };
  };
  
  func recursivelyFindParentView<T>(whereType type: T.Type) -> T? {
    let match = self.recursivelyFindParentView(where: {
      $0 is T;
    })
    
    guard let match = match else { return nil };
    return match as? T;
  };
  
  func recursivelyFindSubview(where predicate: (UIView) -> Bool) -> UIView? {
    for subview in self.subviews {
      if predicate(subview) {
        return subview;
      };
      
      if let match = subview.recursivelyFindSubview(where: predicate) {
        return match;
      };
    };
    
    return nil;
  };
  
  func recursivelyFindSubview<T>(whereType type: T.Type) -> T? {
    let match = self.recursivelyFindSubview(where: {
      $0 is T;
    })
    
    guard let match = match else { return nil };
    return match as? T;
  };
  
  func displayNow(){
    self.setNeedsLayout();
    self.layer.setNeedsDisplay();
    
    self.layer.displayIfNeeded();
    self.layoutIfNeeded();
  };
};
