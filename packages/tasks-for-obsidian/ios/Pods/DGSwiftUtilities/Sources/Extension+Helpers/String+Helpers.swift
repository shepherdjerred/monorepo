//
//  String+Helpers.swift
//  
//
//  Created by Dominic Go on 11/29/24.
//

import Foundation


public extension String {
  
  static func createTimestamp(
    forDate date: Date = Date(),
    withDateFormat dateFormat: String = "HH:mm:ss.SSS"
  ) -> String {
    let dateFormatter = DateFormatter();
    dateFormatter.dateFormat = dateFormat;
    return dateFormatter.string(from: date);
  };
};
