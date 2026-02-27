//
//  ImageConfigParsing.swift
//  
//
//  Created by Dominic Go on 7/29/24.
//

import UIKit


public protocol ImageConfigParsing {
  
  typealias ParsableImageConfig = ImageConfig & InitializableFromDictionary;
  
  typealias ImageConfigEntry = ParsableImageConfig.Type;
  typealias ImageConfigMap = [String: ImageConfigEntry];
  
  static var configTypeItems: [ImageConfigEntry] { get set };
  
  static var configTypeMapCache: ImageConfigMap { get set };
};

// MARK: - ImageConfigParsing+PrivateHelpers
// -----------------------------------------

fileprivate extension ImageConfigParsing {
  
  static var didSetConfigTypeMapCache: Bool {
    Self.configTypeItems.count == Self.configTypeMapCache.count;
  };
  
  static func setConfigTypeMapCache(){
    Self.configTypeMapCache = Self.configTypeItems.reduce(into: [:]) {
      $0[$1.imageType] = $1;
    };
  };
};

// MARK: - ImageConfigParsing+PublicHelpers
// ----------------------------------------

public extension ImageConfigParsing {

  static var configTypeMap: ImageConfigMap {
    if !Self.didSetConfigTypeMapCache {
      Self.setConfigTypeMapCache();
    };
    
    return Self.configTypeMapCache;
  };

  static func parseImageConfig(
    fromDict dict: Dictionary<String, Any>
  ) throws -> ParsableImageConfig {
    
    let imageType: String = try dict.getValue(forKey: "imageType");
    
    let imageConfigType = Self.configTypeMap[imageType];
    guard let imageConfigType = imageConfigType else {
      throw GenericError(
        errorCode: .unexpectedNilValue
      );
    };
    
    let imageConfig = try imageConfigType.init(fromDict: dict);
    return imageConfig;
  };
};
