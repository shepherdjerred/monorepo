//
//  Array+AnyInterpolator.swift
//  
//
//  Created by Dominic Go on 7/21/24.
//

import Foundation


public extension Array where Element: AnyInterpolator {

  func getInterpolator<T>(
    forInputValue inputValue: CGFloat,
    withStartIndex startIndex: Int? = nil
  ) -> IndexValuePair<Interpolator<T>>? where Element == Interpolator<T> {
    
    let predicate: (_ interpolator: Interpolator<T>) -> Bool = {
         inputValue >= $0.inputValueStart
      && inputValue <= $0.inputValueEnd;
    };
    
    guard let startIndex = startIndex else {
      return self.indexedFirst { _, interpolator in
        predicate(interpolator);
      };
    };
    
    return self.indexedFirstBySeekingForwardAndBackwards(startIndex: startIndex) { item, _ in
      predicate(item.value);
    };
  };
};
