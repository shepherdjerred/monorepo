//
//  Collection+Helpers.swift
//  react-native-ios-modal
//
//  Created by Dominic Go on 4/10/23.
//

import UIKit

public extension Collection {

  typealias IndexElementPair = IndexValuePair<Element>;
  
  var secondToLast: Element? {
    self[safeIndex: self.index(self.indices.endIndex, offsetBy: -2)];
  };

  func isOutOfBounds(forIndex index: Index) -> Bool {
    return index < self.indices.startIndex || index >= self.indices.endIndex;
  };
  
  /// Returns the element at the specified index if it is within bounds,
  /// otherwise nil.
  subscript(safeIndex index: Index) -> Element? {
    return self.isOutOfBounds(forIndex: index) ? nil : self[index];
  };
  
  func firstBySeekingForwards(
    startingAtIndex startIndex: Int,
    where condition: (Element) -> Bool
  ) -> Element? {
  
    guard self.count > 0 else {
      return nil;
    };
    
    for index in startIndex..<self.count {
      let element = self[
        self.index(self.indices.startIndex, offsetBy: index)
      ];
      
      if condition(element) {
        return element;
      };
    };
    
    return nil;
  };
  
  func firstBySeekingBackwards(
    startingAtIndex startIndex: Int? = nil,
    where condition: (Element) -> Bool
  ) -> Element? {
  
    guard self.count > 0 else {
      return nil;
    };
    
    let startIndex = startIndex ?? self.count - 1;
    for index in (0...startIndex).reversed() {
      let element = self[
        self.index(self.indices.startIndex, offsetBy: index)
      ];
      
      if condition(element) {
        return element;
      };
    };
    
    return nil;
  };
  
  func firstBySeekingForwardsThenBackwards(
    startingAtIndex startIndex: Int,
    where condition: (Element, _ isReversing: Bool) -> Bool
  ) -> Element? {
  
    guard self.count > 0 else {
      return nil;
    };
    
    let matchInitial = self.firstBySeekingForwards(
      startingAtIndex: startIndex,
      where: {
        condition($0, false);
      }
    );
    
    if let matchInitial = matchInitial {
      return matchInitial;
    };
    
    return self.firstBySeekingBackwards(
      startingAtIndex: startIndex,
      where: {
        condition($0, true);
      }
    );
  };
  
  func firstBySeekingBackwardsThenForwards (
    startingAtIndex startIndex: Int,
    where condition: (Element, _ isReversing: Bool) -> Bool
  ) -> Element? {
    
    let matchInitial = self.firstBySeekingBackwards(
      startingAtIndex: startIndex,
      where: {
        condition($0, true);
      }
    );
    
    if let matchInitial = matchInitial {
      return matchInitial;
    };
    
    return self.firstBySeekingForwards(
      startingAtIndex: startIndex,
      where: {
        condition($0, false);
      }
    );
  };
  
  func indexedFirstBySeekingForwardAndBackwards(
    startIndex: Int?,
    where predicate: (IndexElementPair, _ isReversing: Bool) -> Bool
  ) -> IndexElementPair? {
    
    guard self.count > 0  else {
      return nil;
    };
    
    let startIndex = startIndex ?? (self.count - 1) / 2;
    
    var seekForwardIndex  = startIndex;
    var seekBackwardIndex = seekForwardIndex - 1;
    
    while true {
      let canSeekForwards  = seekForwardIndex < self.count;
      let canSeekBackwards = seekBackwardIndex >= 0;
      
      if canSeekForwards {
        let index = self.index(self.startIndex, offsetBy: seekForwardIndex);
        let element = self[index];
        
        let indexedElement: IndexElementPair = (seekForwardIndex, element);
        let result = predicate(indexedElement, false);
        
        if result {
          return indexedElement;
        };
        
        seekForwardIndex += 1;
      };
      
      if canSeekBackwards {
        let index = self.index(self.startIndex, offsetBy: seekBackwardIndex);
        let element = self[index];
        
        let indexedElement: IndexElementPair = (seekBackwardIndex, element);
        let result = predicate(indexedElement, true);
        
        if result {
          return indexedElement;
        };
        
        seekBackwardIndex -= 1;
      };
      
      if !canSeekBackwards && !canSeekForwards {
        return nil;
      };
    };
  };
  
  func firstBySeekingForwardAndBackwards(
    startIndex: Int?,
    where predicate: (Element, _ isReversing: Bool) -> Bool
  ) -> Element? {
  
    let match = self.indexedFirstBySeekingForwardAndBackwards(startIndex: startIndex){
      predicate($0.value, $1);
    };
    
    return match?.value;
  };
};

public extension MutableCollection {
  subscript(safeIndex index: Index) -> Element? {
    get {
      return self.isOutOfBounds(forIndex: index) ? nil : self[index];
    }
    
    set {
      guard let newValue = newValue,
            !self.isOutOfBounds(forIndex: index)
      else { return };
      
      self[index] = newValue;
    }
  };
};
