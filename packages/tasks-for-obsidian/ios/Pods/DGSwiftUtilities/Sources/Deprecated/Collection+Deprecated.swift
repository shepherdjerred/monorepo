//
//  Collection+Deprecated.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import Foundation


public extension Collection {
  
  @available(*, deprecated, renamed: "firstBySeekingForwards")
  func seekForward(
    startIndex: Int,
    where condition: (Element) -> Bool
  ) -> Element? {
    
    self.firstBySeekingForwards(
      startingAtIndex: startIndex,
      where: condition
    );
  };
  
  @available(*, deprecated, renamed: "firstBySeekBackwards")
  func seekBackwards(
    startIndex: Int? = nil,
    where condition: (Element) -> Bool
  ) -> Element? {
  
    self.firstBySeekingBackwards(
      startingAtIndex: startIndex,
      where: condition
    );
  };
  
  @available(*, deprecated, renamed: "firstBySeekingForwardsThenBackwards")
  func seekForwardAndBackwards(
    startIndex: Int,
    where condition: (_ item: Element, _ isReversing: Bool) -> Bool
  ) -> Element? {
  
    self.firstBySeekingBackwardsThenForwards(
      startingAtIndex: startIndex,
      where: condition
    );
  };
};
