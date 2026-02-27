//
//  Dictionary+Hepers.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 12/22/23.
//

import Foundation
import UIKit


public extension Dictionary where Key == String {

  var nilIfEmpty: Self? {
    self.count > 0 ? self : nil;
  };
  
  func compactMapKeys<T>(
    _ transform: (Key) throws -> T?
  ) rethrows -> Dictionary<T, Value> {
    
    try self.reduce(into: [:]){
      guard let newKey = try transform($1.key) else { return };
      $0[newKey] = $1.value;
    };
  };
  
  mutating func merge(with otherDict: Self, shouldOverwrite: Bool = true){
    self.merge(otherDict) { (current, new) in
      shouldOverwrite ? new : current;
    };
  };

  mutating func unwrapAndSet(forKey key: Key, with value: Value?){
    guard let value = value else {
      return;
    };
    
    self[key] = value;
  };
  
  mutating func unwrapAndMerge(
    with otherDict: Self?,
    shouldOverwrite: Bool = true
  ){
    guard let otherDict = otherDict else {
      return;
    };
    
    self.merge(with: otherDict, shouldOverwrite: shouldOverwrite);
  };

  // MARK: - Get Value (Via Explicit Casting)
  // ----------------------------------------

  func getValueAndCast<T>(
    forKey key: String,
    type: T.Type  = T.self
  ) throws -> T {
  
    let dictValue = self[key];
    
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Unable to get value from dictionary for key",
        extraDebugValues: [
          "key": key,
          "type": type.self
        ]
      );
    };
    
    guard let value = dictValue as? T else {
      throw GenericError(
        errorCode: .typeCastFailed,
        description: "Unable to parse value from dictionary for key",
        extraDebugValues: [
          "key": key,
          "dictValue": dictValue,
          "type": type.self
        ]
      );
    };
    
    return value;
  };
  
  func getValueAndCast<T>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getValueAndCast(forKey: key, type: type);
    return value ?? fallbackValue;
  };
  
  // MARK: - Get Value (Explicit Primitives)
  // ---------------------------------------
  
  func getValue(forKey key: String) throws -> String {
    try self.getString(forKey: key);
  };
  
  func getValue(forKey key: String) throws -> Int {
    try self.getInt(forKey: key);
  };
  
  func getValue(forKey key: String) throws -> Double {
    try self.getNumber(forKey: key);
  };
  
  func getValue(forKey key: String) throws -> Float {
    try self.getNumber(forKey: key);
  };
  
  func getValue(forKey key: String) throws -> Bool {
    try self.getBool(forKey: key);
  };
  
  // MARK: - Get Value (Explicit Primitives w/ Fallback)
  // ---------------------------------------------------
  
  func getValue(
    forKey key: String,
    fallbackValue: String
  ) -> String {
    (try? self.getString(forKey: key)) ?? fallbackValue;
  };
  
  func getValue(
    forKey key: String,
    fallbackValue: Int
  ) -> Int {
    (try? self.getInt(forKey: key)) ?? fallbackValue;
  };
  
  func getValue(
    forKey key: String,
    fallbackValue: Double
  ) -> Double {
    (try? self.getNumber(forKey: key)) ?? fallbackValue;
  };
  
  func getValue(
    forKey key: String,
    fallbackValue: Float
  ) -> Float {
    (try? self.getNumber(forKey: key)) ?? fallbackValue;
  };
  
  func getValue(
    forKey key: String,
    fallbackValue: Bool
  ) -> Bool {
    (try? self.getBool(forKey: key)) ?? fallbackValue;
  };
  
  // MARK: - Get Value (Container Types)
  // -----------------------------------
  
  func getValue(
    forKey key: String,
    allowMissingValues: Bool = true
  ) throws -> [String] {
    try self.getArray(forKey: key, allowMissingValues: allowMissingValues);
  };
  
  func getValue<T: BinaryInteger>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true
  ) throws -> [T] {
    try self.getArray(forKey: key);
  };
  
  func getValue<T: BinaryFloatingPoint>(
    forKey key: String,
    elementType: T.Type = T.self
  ) throws -> [T] {
    try self.getArray(forKey: key);
  };
  
  func getValue<T: RawRepresentable<String>>(
    forKey key: String,
    elementType: T.Type = T.self
  ) throws -> [T] {
    try self.getArray(forKey: key);
  };
  
  func getValue<T: InitializableFromString>(
    forKey key: String,
    elementType: T.Type = T.self
  ) throws -> [T] {
    try self.getArray(forKey: key);
  };
  
  func getValue(forKey key: String) throws -> [String: Any] {
    try self.getDict(forKey: key);
  };
  
  // MARK: - Get Value (Explicit Non-Primitive Types)
  // ------------------------------------------------
  
  func getValue(forKey key: String) throws -> UIColor {
    try self.getColor(forKey: key);
  };
  
  func getValue(forKey key: String) throws -> CGColor {
    try self.getColor(forKey: key).cgColor;
  };
  
  // MARK: - Get Value (Generics)
  // ----------------------------
  
  func getValue<T: InitializableFromDictionary>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
    
    let dictValue = try self.getDict(forKey: key);
    return try T.init(fromDict: dictValue);
  };
  
  func getValue<T: CreatableFromDictionary>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue = try self.getDict(forKey: key);
    return try T.create(fromDict: dictValue);
  };
  
  func getValue<T: InitializableFromString>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue = try self.getString(forKey: key);
    return try T.init(fromString: dictValue);
  };
  
  func getValue<T: OptionSet & InitializableFromString>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let stringValues = try self.getArray(
      forKey: key,
      elementType: String.self
    );
    
    var optionSets = stringValues.compactMap {
      try? T.init(fromString: $0);
    };
    
    guard let optionSetItem = optionSets.popLast() else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "array of optionSet values is 0",
        extraDebugValues: [
          "key": key,
          "type": type.self
        ]
      );
    };
    
    return optionSets.reduce(optionSetItem) {
      $0.union($1);
    };
  };
  
  func getValue<T: RawRepresentable, U>(
    forKey key: String,
    type: T.Type = T.self,
    rawValueType: U.Type = T.RawValue.self
  ) throws -> T where T: RawRepresentable<U> {
  
    let rawValue = try? self.getValueAndCast(
      forKey: key,
      type: U.self
    );
    
    guard let rawValue = rawValue else {
      throw GenericError(
        errorCode: .typeCastFailed,
        description: "Unable to cast value to RawRepresentable.RawValue type",
        extraDebugValues: [
          "key": key,
          "type": type.self,
          "rawValueType": U.self,
        ]
      );
    };
    
    let value = T.init(rawValue: rawValue);
    guard let value = value else {
      throw GenericError(
        errorCode: .invalidValue,
        description: "No matching value in enum",
        extraDebugValues: [
          "key": key,
          "type": type.self,
          "rawValueType": U.self,
        ]
      );
    };
    
    return value;
  };
  
  func getValue<T: BinaryInteger>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
    
    try self.getNumber(forKey: key, type: type);
  };
  
  func getValue<T: BinaryFloatingPoint>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    try self.getNumber(forKey: key, type: type);
  };
  
  // MARK: - Get Value (Generics w/ Fallback)
  // ----------------------------------------
  
  func getValue<T: InitializableFromDictionary>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getValue(forKey: key, type: T.self);
    return value ?? fallbackValue;
  };
  
  func getValue<T: CreatableFromDictionary>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getValue(forKey: key, type: T.self);
    return value ?? fallbackValue;
  };
  
  func getValue<T: InitializableFromString>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getValue(forKey: key, type: T.self);
    return value ?? fallbackValue;
  };
  
  func getValue<T: OptionSet & InitializableFromString>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getValue(forKey: key, type: T.self);
    return value ?? fallbackValue;
  };
  
  func getValue<T: BinaryInteger>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getValue(forKey: key, type: T.self);
    return value ?? fallbackValue;
  };
  
  func getValue<T: BinaryFloatingPoint>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getValue(forKey: key, type: T.self);
    return value ?? fallbackValue;
  };
  
  func getValue<T: RawRepresentable, U>(
    forKey key: String,
    type: T.Type = T.self,
    rawValueType: U.Type = T.RawValue.self,
    fallbackValue: T
  ) -> T where T: RawRepresentable<U> {
  
    let enumValue = try? self.getValue(
      forKey: key,
      type: T.self,
      rawValueType: U.self
    );
    
    guard let enumValue = enumValue else {
      return fallbackValue;
    };
    
    return enumValue;
  };
  
  // MARK: - Explicit Generic Getters
  // --------------------------------
  
  func getNumber<T: BinaryInteger>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue = self[key];
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "corresponding key in dict has no value",
        extraDebugValues: [
          "key": key,
          "type": type.self,
        ]
      );
    };
    
    switch dictValue {
      case let number as NSNumber:
        return .init(number.intValue);
        
      case let number as any BinaryInteger:
        return .init(number);
    
      case let number as any BinaryFloatingPoint:
        return .init(number);
      
      default:
        throw GenericError(
          errorCode: .invalidValue,
          description: "Unable to convert dictValue to number",
          extraDebugValues: [
            "key": key,
            "dictValue": dictValue,
            "type": type.self,
          ]
        );
    };
  };

  func getNumber<T: BinaryFloatingPoint>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue = self[key];
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "corresponding key in dict has no value",
        extraDebugValues: [
          "key": key,
          "type": type.self,
        ]
      );
    };
    
    switch dictValue {
      case let number as NSNumber:
        return .init(number.doubleValue);
    
      case let number as any BinaryFloatingPoint:
        return .init(number);
        
      case let number as any BinaryInteger:
        return .init(number);
      
      default:
        throw GenericError(
          errorCode: .invalidValue,
          description: "Unable to convert dictValue to number",
          extraDebugValues: [
            "key": key,
            "dictValue": dictValue,
            "type": type.self,
          ]
        );
    };
  };
  
  func getInt<T: BinaryInteger>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue = self[key];
    
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "corresponding key in dict has no value",
        extraDebugValues: [
          "key": key,
          "type": type,
        ]
      );
    };
    
    switch dictValue {
      case let number as NSNumber:
        return .init(number.intValue);
        
      case let number as any BinaryInteger:
        return .init(number);
    
      case let number as any BinaryFloatingPoint:
        return .init(number);
      
      default:
        throw GenericError(
          errorCode: .invalidValue,
          description: "Unable to convert dictValue to number",
          extraDebugValues: [
            "key": key,
            "dictValue": dictValue,
          ]
        );
    };
  };
  
  func getEnum<T: RawRepresentable<String>>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue: String = try self.getValue(forKey: key);
    
    guard let value = T(rawValue: dictValue) else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Unable to convert string from dictionary to enum",
        extraDebugValues: [
          "key": key,
          "dictValue": dictValue,
          "type": type.self,
        ]
      );
    };
    
    return value;
  };
  
  func getEnum<T: InitializableFromString>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue: String = try self.getValue(forKey: key);
    let value = try T.init(fromString: dictValue)
    
    return value;
  };
  
  func getEnum<T: EnumCaseStringRepresentable & CaseIterable>(
    forKey key: String,
    type: T.Type = T.self
  ) throws -> T {
  
    let dictValue: String = try self.getValue(forKey: key);
    
    guard let value = T(fromString: dictValue) else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Unable to convert string from dictionary to enum",
        extraDebugValues: [
          "key": key,
          "dictValue": dictValue,
          "type": type.self,
          "validValues": T.allCases.reduce(into: "") {
            $0 += $1.caseString + ", ";
          }
        ]
      );
    };
    
    return value;
  };
  
  func getKeyPath<
    KeyPathRoot: StringKeyPathMapping,
    KeyPathValue
  >(
    forKey key: String,
    rootType: KeyPathRoot.Type,
    valueType: KeyPathValue.Type
  ) throws -> KeyPath<KeyPathRoot, KeyPathValue> {
  
    let dictValue: String = try self.getValue(forKey: key);
    
    return try KeyPathRoot.getKeyPath(
      forKey: dictValue,
      valueType: KeyPathValue.self
    );
  };
  
  // MARK: - Explicit Concrete Getters
  // ---------------------------------
  
  func getInt(forKey key: String) throws -> Int {
    try self.getInt(forKey: key, type: Int.self);
  };
  
  func getDouble(forKey key: String) throws -> Double {
    try self.getNumber(forKey: key);
  };
  
  func getFloat(forKey key: String) throws -> Float {
    try self.getNumber(forKey: key);
  };
  
  func getString(forKey key: String) throws -> String {
    let dictValue = self[key];
    
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "corresponding key in dict has no value",
        extraDebugValues: [
          "key": key
        ]
      );
    };
    
    switch dictValue {
      case let swiftString as String:
        return swiftString;
        
      case let objcString as NSString:
        return objcString as String;
    
      default:
        throw GenericError(
          errorCode: .invalidValue,
          description: "Unable to convert dictValue to string",
          extraDebugValues: [
            "key": key,
            "dictValue": dictValue,
          ]
        );
    };
  };
  
  func getBool(forKey key: String) throws -> Bool {
    let dictValue = self[key];
    
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "corresponding key in dict has no value",
        extraDebugValues: [
          "key": key
        ]
      );
    };
    
    switch dictValue {
      case let boolValue as Bool:
        return boolValue;
        
      case let objcNumber as NSNumber:
        return objcNumber.boolValue;
        
      case let intValue as Int:
        return intValue > 0;
    
      default:
        throw GenericError(
          errorCode: .invalidValue,
          description: "Unable to convert dictValue to string",
          extraDebugValues: [
            "key": key,
            "dictValue": dictValue,
          ]
        );
    };
  };
  
  func getColor(forKey key: String) throws -> UIColor {
    guard let colorValue = self[key] else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Unable to get value from dictionary for key",
        extraDebugValues: [
          "key": key,
        ]
      );
    };
    
    if let colorValue = colorValue as? UIColor {
      return colorValue;
    };
    
    guard let color = UIColor.parseColor(value: colorValue) else {
      throw GenericError(
        errorCode: .invalidValue,
        description: "Unable to parse color value",
        extraDebugValues: [
          "key": key,
          "colorValue": colorValue,
        ]
      );
    };
    
    return color;
  };
  
  // MARK: - Explicit Getters (w/ Fallback)
  // --------------------------------------
  
  func getNumber<T: BinaryInteger>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getNumber(
      forKey: key,
      type: type
    );
    
    return value ?? fallbackValue;
  };
  
  func getNumber<T: BinaryFloatingPoint>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
  
    let value = try? self.getNumber(
      forKey: key,
      type: type
    );
    
    return value ?? fallbackValue;
  };
  
  func getInt<T: BinaryInteger>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) throws -> T {
    
    let value = try? self.getInt(forKey: key, type: type);
    return value ?? fallbackValue;
  };
  
  func getString(
    forKey key: String,
    fallbackValue: String
  ) -> String {
    
    let value = try? self.getString(forKey: key);
    return value ?? fallbackValue;
  };
  
  func getBool(
    forKey key: String,
    fallbackValue: Bool
  ) -> Bool {
    
    let value = try? self.getBool(forKey: key);
    return value ?? fallbackValue;
  };
  
  func getColor(
    forKey key: String,
    fallbackValue: UIColor
  ) -> UIColor {
    
    let value = try? self.getColor(forKey: key);
    return value ?? fallbackValue;
  };
  
  func getEnum<T: RawRepresentable<String>>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
    
    let value = try? self.getEnum(forKey: key, type: type);
    return value ?? fallbackValue;
  };
  
  func getEnum<T: InitializableFromString>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
    
    let value = try? self.getEnum(forKey: key, type: type);
    return value ?? fallbackValue;
  };
  
  func getEnum<T: EnumCaseStringRepresentable & CaseIterable>(
    forKey key: String,
    type: T.Type = T.self,
    fallbackValue: T
  ) -> T {
    
    let value = try? self.getEnum(forKey: key, type: type);
    return value ?? fallbackValue;
  };
  
  func getKeyPath<
    KeyPathRoot: StringKeyPathMapping,
    KeyPathValue
  >(
    forKey key: String,
    rootType: KeyPathRoot.Type,
    valueType: KeyPathValue.Type,
    fallbackValue: KeyPath<KeyPathRoot, KeyPathValue>
  ) -> KeyPath<KeyPathRoot, KeyPathValue> {
    
    let value = try? self.getKeyPath(
      forKey: key,
      rootType: rootType,
      valueType: valueType
    );
    
    return value ?? fallbackValue;
  };
  
  // MARK: - Explicit Getters For Container Types
  // --------------------------------------------
  
  func getArray<T>(
    forKey key: String,
    elementType: T.Type = T.self,
    transform transformBlock: (Any) throws -> T?
  ) throws -> Array<T> {
  
    let dictValue = self[key];
    
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Unable to get array from dictionary for key",
        extraDebugValues: [
          "key": key,
          "elementType": elementType.self
        ]
      );
    };
    
    if let array = dictValue as? Array<T> {
      return array;
    };
    
    guard let rawArray = dictValue as? Array<Any> else {
      throw GenericError(
        errorCode: .typeCastFailed,
        description: "Unable to parse array from dictionary for key",
        extraDebugValues: [
          "key": key,
          "dictValue": dictValue,
          "type": elementType.self
        ]
      );
    };

    return try rawArray.enumerated().compactMap {
      do {
        return try transformBlock($0.element);
      
      } catch {
        throw GenericError(
          errorCode: .typeCastFailed,
          description: "Unable to parse element from array",
          extraDebugValues: [
            "key": key,
            "dictValue": dictValue,
            "type": elementType.self,
            "element": $0,
            "index": $0.offset,
            "rawArray": rawArray,
            "rawArrayCount": rawArray.count,
            "innerError": error.localizedDescription,
          ]
        );
      }
    };
  };
  
  func getArray<T>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true
  ) throws -> Array<T> {
  
    try self.getArray(forKey: key) {
      switch ($0, allowMissingValues) {
        case (let value as T, _):
          return value;
          
        case (_, true):
          return nil;
        
        default:
          throw GenericError(
            errorCode: .invalidValue,
            description: "Unable to convert element",
            extraDebugValues: [
              "key": key,
              "elementType": elementType,
              "allowMissingValues": allowMissingValues,
            ]
          );
      };
    };
  };

  func getArray<T: BinaryInteger>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true
  ) throws -> Array<T> {
  
    try self.getArray(forKey: key) {
      switch ($0, allowMissingValues) {
        case (let number as NSNumber, _):
          return .init(number.intValue);
          
        case (let number as any BinaryInteger, _):
          return .init(number);
      
        case (let number as any BinaryFloatingPoint, _):
          return .init(number);
          
        case (_, true):
          return nil;
        
        default:
          throw GenericError(
            errorCode: .invalidValue,
            description: "Unable to convert element to number",
            extraDebugValues: [
              "key": key,
              "elementType": elementType,
              "allowMissingValues": allowMissingValues,
            ]
          );
      };
    };
  };
  
  func getArray<T: BinaryFloatingPoint>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true
  ) throws -> Array<T> {
  
    try self.getArray(forKey: key) {
      switch ($0, allowMissingValues) {
        case (let number as NSNumber, _):
          return .init(number.doubleValue);
          
        case (let number as any BinaryInteger, _):
          return .init(number);
      
        case (let number as any BinaryFloatingPoint, _):
          return .init(number);
          
        case (_, true):
          return nil;
        
        default:
          throw GenericError(
            errorCode: .invalidValue,
            description: "Unable to convert element to number",
            extraDebugValues: [
              "key": key,
              "elementType": elementType,
              "allowMissingValues": allowMissingValues,
            ]
          );
      };
    };
  };
  
  func getArray(
    forKey key: String,
    allowMissingValues: Bool = true
  ) throws -> Array<String> {
  
    try self.getArray(forKey: key) {
      switch ($0, allowMissingValues) {
        case (let string as String, _):
          return string;
          
        case (let objcString as NSString, _):
          return objcString as String;

        case (_, true):
          return nil;
        
        default:
          throw GenericError(
            errorCode: .invalidValue,
            description: "Unable to convert element to string",
            extraDebugValues: [
              "key": key,
              "allowMissingValues": allowMissingValues,
            ]
          );
      };
    };
  };
  
  func getArray<T: RawRepresentable<String>>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true
  ) throws -> Array<T> {
  
    try self.getArray(forKey: key) {
      switch ($0, allowMissingValues) {
        case (let string as String, _):
          guard let value: T = .init(rawValue: string) else {
            fallthrough;
          };
          return value;

        case (_, true):
          return nil;
        
        default:
          throw GenericError(
            errorCode: .invalidValue,
            description: "Unable to convert element",
            extraDebugValues: [
              "key": key,
              "elementType": elementType,
              "allowMissingValues": allowMissingValues,
            ]
          );
      };
    };
  };
  
  func getArray<T: InitializableFromString>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true
  ) throws -> Array<T> {
  
    try self.getArray(forKey: key) {
      switch ($0, allowMissingValues) {
        case (let string as String, _):
          return allowMissingValues
            ? try? .init(fromString: string)
            : try  .init(fromString: string)
          
        case (_, true):
          return nil;
        
        default:
          throw GenericError(
            errorCode: .invalidValue,
            description: "Unable to convert element",
            extraDebugValues: [
              "key": key,
              "elementType": elementType,
              "allowMissingValues": allowMissingValues,
            ]
          );
      };
    };
  };
  
  func getArray<T: InitializableFromDictionary>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true
  ) throws -> Array<T> {
  
    try self.getArray(forKey: key) {
      switch ($0, allowMissingValues) {
        case (let dict as Dictionary<String, Any>, _):
          return allowMissingValues
            ? try? .init(fromDict: dict)
            : try  .init(fromDict: dict);
          
        case (let objcDict as NSDictionary, _):
          guard let dict = objcDict as? Dictionary<String, Any> else {
            fallthrough
          };
          
          return allowMissingValues
            ? try? .init(fromDict: dict)
            : try  .init(fromDict: dict);
          
        case (_, true):
          return nil;
        
        default:
          throw GenericError(
            errorCode: .invalidValue,
            description: "Unable to convert element",
            extraDebugValues: [
              "key": key,
              "elementType": elementType,
              "allowMissingValues": allowMissingValues,
            ]
          );
      };
    };
  };

  func getDict<T: Hashable, U>(
    forKey key: String,
    keyType: T.Type = String.self,
    valueType: U.Type = Any.self
  ) throws -> Dictionary<T, U> {
  
    let dictValue = self[key];
    
    guard let dictValue = dictValue else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Unable to get dict from dictionary for key",
        extraDebugValues: [
          "key": key,
          "keyType": keyType.self,
          "valueType": valueType.self
        ]
      );
    };
    
    switch dictValue {
      case let objcDict as NSDictionary:
        guard let dict = objcDict as? Dictionary<T, U> else {
          throw GenericError(
            errorCode: .unexpectedNilValue,
            description: "Unable to convert objc dict to target type",
            extraDebugValues: [
              "key": key,
              "keyType": keyType.self,
              "valueType": valueType.self,
              "objcDict": objcDict,
            ]
          );
        };
        
        return dict;
    
      case let dict as Dictionary<T, U>:
        return dict;
        
      default:
        break;
    };
    
    throw GenericError(
      errorCode: .invalidValue,
      description: "Unable to convert dict to target type",
      extraDebugValues: [
        "key": key,
        "keyType": keyType.self,
        "valueType": valueType.self,
        "dictValue": dictValue,
      ]
    );
  };
  
  // MARK: - Explicit Getters For Container Types (w/ Fallback)
  // ----------------------------------------------------------
  
  func getArray<T>(
    forKey key: String,
    elementType: T.Type = T.self,
    allowMissingValues: Bool = true,
    fallbackValue: Array<T>
  ) -> Array<T> {
  
    let value = try? self.getArray(
      forKey: key,
      elementType: elementType,
      allowMissingValues: allowMissingValues
    );
    
    return value ?? fallbackValue;
  };
  
  func getDict<T: Hashable, U>(
    forKey key: String,
    keyType: T.Type = String.self,
    valueType: U.Type = Any.self,
    fallbackValue: Dictionary<T, U>
  ) -> Dictionary<T, U> {
  
    let value = try? self.getDict(
      forKey: key,
      keyType: keyType,
      valueType: valueType
    );
    
    return value ?? fallbackValue;
  };
};
