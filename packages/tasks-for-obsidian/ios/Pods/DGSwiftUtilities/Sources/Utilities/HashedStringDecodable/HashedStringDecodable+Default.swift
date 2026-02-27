//
//  HashedStringDecodable+Default.swift
//  
//
//  Created by Dominic Go on 10/8/23.
//

import Foundation

fileprivate var decodedStringCache: Dictionary<String, String> = [:];

public extension HashedStringDecodable {

  var rawValue: String {
    self.decodedString ?? self.encodedString;
  };

  var decodedString: String? {
    let encodedString = self.encodedString;
    
    if let decodedString = decodedStringCache[encodedString] {
      return decodedString;
    };
    
    guard let data = Data(base64Encoded: encodedString),
          let decodedString = String(data: data, encoding: .utf8)
    else {
      #if DEBUG
      print(
        "HashedStringDecodable.decodedString",
        "\n- encodedString: \(encodedString)",
        "\n- couldn't decode string",
        "\n"
      );
      #endif
      return nil;
    };
    
    decodedStringCache[encodedString] = decodedString;
    return decodedString;
  };
};

public extension HashedStringDecodable where Self: CaseIterable {

  init?(rawValue: String) {
    let match = Self.allCases.first {
      if let decodedString = $0.decodedString {
        return decodedString == rawValue;
      };
      
      return $0.encodedString == rawValue;
    };
    
    guard let match = match else { return nil };
    self = match;
  };
};
