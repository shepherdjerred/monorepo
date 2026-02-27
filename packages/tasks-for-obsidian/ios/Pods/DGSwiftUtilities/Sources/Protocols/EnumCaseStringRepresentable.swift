//
//  EnumCaseStringRepresentable.swift
//  
//
//  Created by Dominic Go on 12/17/23.
//

import Foundation



public protocol EnumCaseStringRepresentable {

  var caseString: String { get };
};

public extension EnumCaseStringRepresentable where Self: RawRepresentable<String> {

  var caseString: String {
    self.rawValue;
  };
};

public extension EnumCaseStringRepresentable where Self: CaseIterable {

  init?(fromString string: String){
    let match = Self.allCases.first {
      $0.caseString == string;
    };
    
    guard let match = match else { return nil };
    self = match;
  };
};

public extension CustomStringConvertible where Self: EnumCaseStringRepresentable {
  
  var description: String {
    self.caseString;
  };
};


