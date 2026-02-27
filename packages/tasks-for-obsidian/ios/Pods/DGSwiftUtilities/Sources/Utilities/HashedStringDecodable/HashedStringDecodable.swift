//
//  HashedStringDecodable.swift
//  
//
//  Created by Dominic Go on 10/8/23.
//

import Foundation

public protocol HashedStringDecodable  {

  var encodedString: String { get };
  
  var decodedString: String? { get };
};
