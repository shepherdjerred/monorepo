//
//  StringAnyKeyPathMapping+Functions.swift
//
//
//  Created by Dominic Go on 12/27/23.
//

import Foundation


/// Cached values for `StringAnyKeyPathMapping.anyKeyPathValueTypes`
/// for each type that conforms to `StringAnyKeyPathMapping`.
///
fileprivate var __cacheKeyPathValueTypes:
  Dictionary<String, [StringAnyKeyPathMapping.Type]> = [:];

/// Cached values for
/// `StringAnyKeyPathMapping.recursivelyGetAllKeyPathValueTypes`
/// for each type that conforms to `StringAnyKeyPathMapping`.
///
fileprivate var __cacheAllKeyPathValueTypes:
  Dictionary<String, [StringAnyKeyPathMapping.Type]> = [:];

extension StringAnyKeyPathMapping {

  // MARK: - Private - Caching Helpers
  // ---------------------------------
  
  private static var _typeName: String {
    String(describing: Self.self);
  };
  
  /// Cached values for `StringAnyKeyPathMapping.keyPathValueTypes`
  private static var _cacheKeyPathValueTypes: [StringAnyKeyPathMapping.Type]? {
    get {
      __cacheKeyPathValueTypes[Self._typeName];
    }
    set {
      __cacheKeyPathValueTypes[Self._typeName] = newValue;
    }
  };
  
  /// Cached values for
  /// `StringAnyKeyPathMapping.recursivelyGetAllKeyPathValueTypes`
  ///
  private static var _cacheAllKeyPathValueTypes: [StringAnyKeyPathMapping.Type]? {
    get {
      __cacheAllKeyPathValueTypes[Self._typeName];
    }
    set {
      __cacheAllKeyPathValueTypes[Self._typeName] = newValue;
    }
  };
  
  // MARK: - Private Helpers
  // -----------------------

  /// All of the `Value.Type` items from `KeyPath<Root, Value>` in
  /// `Self.anyKeyPathMap`, that conforms to `StringAnyKeyPathMapping`.
  ///
  private static var keyPathValueTypes: [StringAnyKeyPathMapping.Type] {
    if let _cacheKeyPathValueTypes = Self._cacheKeyPathValueTypes {
      return _cacheKeyPathValueTypes;
    };
  
    let types = Self.anyKeyPathMap.compactMap {
      let keyPath = $0.value;
      let keyPathValueType = type(of: keyPath).valueType;
      
      return keyPathValueType as? StringAnyKeyPathMapping.Type;
    };
    
    var uniqueTypes: [StringAnyKeyPathMapping.Type] = [];
    
    for type in types {
      let match = uniqueTypes.first {
        $0 == type;
      };
      
      /// skip `type` item if already exists in `uniqueTypes`
      guard match == nil else { continue };
      uniqueTypes.append(type);
    };
    
    Self._cacheKeyPathValueTypes = uniqueTypes;
    return uniqueTypes;
  };
  
  private static var allKeyPathValueTypes: [StringAnyKeyPathMapping.Type] {
    Self.recursivelyGetAllKeyPathValueTypes();
  };
  
  private static func recursivelyGetAllKeyPathValueTypes(
    currentItems: [StringAnyKeyPathMapping.Type]? = nil
  ) -> [StringAnyKeyPathMapping.Type] {
    
    if let _cacheAllKeyPathValueTypes = Self._cacheAllKeyPathValueTypes {
      return _cacheAllKeyPathValueTypes;
    };
  
    var keyPathValueTypes: [StringAnyKeyPathMapping.Type] = [Self.self];
    
    for type in Self.keyPathValueTypes {
      let shouldSkip: Bool = {
        guard let currentItems = currentItems else { return false };
        
        let match = currentItems.first {
          $0 == type;
        };
        
        // Duplicate - current item already exists in
        // `allKeyPathValueTypes`.
        return match != nil;
      }();
      
      guard !shouldSkip else { continue };
      keyPathValueTypes.append(type);
      
      keyPathValueTypes += type.recursivelyGetAllKeyPathValueTypes(
        currentItems: keyPathValueTypes
      );
    };
    
    Self._cacheAllKeyPathValueTypes = keyPathValueTypes;
    return keyPathValueTypes;
  };
  
  // MARK: - Public Functions
  // ------------------------
  
  public static func getAnyKeyPath(
    forKey stringKey: String
  ) throws -> AnyKeyPath {
    
    /// Converts "string key" literal: "foo.bar.baz",
    /// to an array of string keys: `["foo", "bar", "baz"]`
    ///
    let stringKeys: [String] = {
      let rawKeys = stringKey.components(separatedBy: ".");

      return rawKeys.compactMap {
        let components = $0.components(
          separatedBy: CharacterSet.alphanumerics.inverted
        );
        
        let filteredString = components.joined();
        guard !filteredString.isEmpty else { return nil };
        
        return filteredString;
      };
    }();
    
    guard stringKeys.count > 0 else {
      throw GenericError(
        errorCode: .guardCheckFailed,
        description: "Number of keys in key path must be > 0",
        extraDebugValues: [
          "stringKey": stringKey,
        ]
      );
    };
    
    let allKeyPathValueTypes = Self.allKeyPathValueTypes;
    
    let anyKeyPaths = stringKeys.compactMap { stringKey in
      for typeItem in allKeyPathValueTypes {
        guard let anyKeyPath = typeItem.anyKeyPathMap[stringKey]
        else { continue };
        
        return anyKeyPath;
      };
      
      return nil;
    };
    
    guard anyKeyPaths.count > 0 else {
      throw GenericError(
        errorCode: .guardCheckFailed,
        description: "Number of parsed keys in key path must be > 0",
        extraDebugValues: [
          "stringKey": stringKey,
        ]
      );
    };
    
    let combinedAnyKeyPath: AnyKeyPath = try {
      var keyPaths = anyKeyPaths;
      let rootKeyPath = keyPaths.removeFirst();
      
      return try keyPaths.reduce(rootKeyPath) {
        guard let combined = $0.appending(path: $1) else {
          throw GenericError(
            errorCode: .guardCheckFailed,
            description: "Unable to combine key paths together",
            extraDebugValues: [
              "stringKey": stringKey,
              "anyKeyPaths": anyKeyPaths,
              "keyPathCurrent": $0,
              "keyPathNext": $1,
            ]
          );
        };
        
        return combined;
      };
    }();
    
    return combinedAnyKeyPath;
  };
  
  public static func getPartialKeyPath(
    forKey stringKey: String
  ) throws -> PartialKeyPath<Self> {
    
    let anyKeyPath = try Self.getAnyKeyPath(forKey: stringKey);
    
    guard let partialKeyPath = anyKeyPath as? PartialKeyPath<Self> else {
      throw GenericError(
        errorCode: .guardCheckFailed,
        description: "Cast to PartialKeyPath failed",
        extraDebugValues: [
          "stringKey": stringKey,
          "anyKeyPath": anyKeyPath,
          "Self": String(describing: Self.self),
        ]
      );
    };
    
    return partialKeyPath;
  };
  
  public static func getKeyPath<T>(
    forKey stringKey: String,
    valueType: T.Type
  ) throws -> KeyPath<Self, T> {
    
    let partialKeyPath = try Self.getPartialKeyPath(forKey: stringKey);
    
    guard let keyPath = partialKeyPath as? KeyPath<Self, T> else {
      throw GenericError(
        errorCode: .guardCheckFailed,
        description: "Cast to KeyPath failed",
        extraDebugValues: [
          "stringKey": stringKey,
          "partialKeyPath": partialKeyPath,
          "Self": String(describing: Self.self),
          "valueType": String(describing: T.self),
        ]
      );
    };
    
    return keyPath;
  };
};
