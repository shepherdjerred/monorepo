//
//  VerboseError.swift
//  react-native-ios-navigator
//
//  Created by Dominic Go on 9/11/21.
//

import Foundation


public struct VerboseError<
  Metadata: ErrorMetadata,
  Code: ErrorCode
>: LocalizedError {

  public static var shouldLogFileMetadata: Bool {
       VerboseErrorSharedEnv.overrideShouldLogFileMetadata
    ?? Metadata.shouldLogFileMetadata;
  };
  
  public static var shouldLogFilePath: Bool {
       VerboseErrorSharedEnv.overrideShouldLogFilePath
    ?? Metadata.shouldLogFilePath;
  };

  public static var shouldLogStackTrace: Bool {
       VerboseErrorSharedEnv.overrideEnableLogStackTrace
    ?? Metadata.shouldLogStackTrace;
  };
  
  // MARK: - Properties
  // ------------------

  public var errorCode: Code?;
  public var description: String?;
  
  public var extraDebugValues: Dictionary<String, Any>?;
  public var extraDebugInfo: String?;

  public var filePath: String;
  public var lineNumber: Int;
  public var columnNumber: Int;
  public var functionName: String;
  
  public var stackTrace: [String]?;
  
  public var senderTypeString: String?;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var debugMetadata: String {
    var string = "";
  
    string += "functionName: \(self.functionName)";
    string += " - lineNumber: \(self.lineNumber)";
    string += " - columnNumber: \(self.columnNumber)";
    
    let fileURL: URL? = Self.shouldLogFileMetadata
      ? .init(fileURLWithPath: self.filePath)
      : nil;
    
    if let fileURL = fileURL {
      string += " - fileName: \(fileURL.lastPathComponent)";
    };
    
    if Self.shouldLogFilePath {
      string += " - path: \(self.filePath)";
    };
    
    if let senderTypeString = self.senderTypeString {
      string += " - senderType: \(senderTypeString)";
    };
    
    if let parentType = Metadata.parentType {
      string += " - parentType: \(parentType)";
    };
    
    return string;
  };
  
  public var debugStackTrace: String? {
    guard let stackTrace = self.stackTrace else { return nil };

    return stackTrace.enumerated().reduce(""){
      let isFirst = $1.offset == 0;
      return isFirst
        ? $0 + $1.element
        : "\($0) - \($1.element)"
    };
  };
  
  var extraDebugValuesString: String? {
    guard let extraDebugValues = self.extraDebugValues else { return nil };
    
    let items = extraDebugValues.enumerated().map {
      var string = "\($0.element.key): \($0.element.value)";
      
      let isLastItem = ($0.offset == extraDebugValues.count - 1);
      string += isLastItem ? "" : ", ";
      
      return string;
    };
    
    let itemsString = items.reduce("") {
      $0 + $1;
    };
    
    return "extraDebugValuesString: { \(itemsString) }";
  };
  
  public var baseErrorMessage: String {
    var strings: [String] = [];
    
    if let domain = Metadata.domain {
      strings.append("domain: \(domain)");
    };
  
    if let errorCode = self.errorCode {
      strings.append("code: \(errorCode.rawValue)");
    };
    
    if let description = self.description {
      strings.append("description: \(description)");
    };
  
    if let extraDebugInfo = self.extraDebugInfo {
      strings.append("extraDebugInfo: \(extraDebugInfo)");
    };
    
    if let extraDebugValuesString = self.extraDebugValuesString {
      strings.append("extraDebugValues: \(extraDebugValuesString)");
    };
    
    return strings.enumerated().reduce("") { acc, next in
      let prefix = next.offset > 0 ? " - " : "";
      return acc + prefix + next.element;
    };
  };
  
  public var errorDescription: String? {
    var message =
      "Error: \(self.baseErrorMessage)"
    + " - Error Metadata: \(self.debugMetadata)";
    
    if let debugStackTrace = self.debugStackTrace {
      message += " - Stack Trace: \(debugStackTrace)";
    };
    
    return message;
  };
  
  // MARK: - Init
  // ------------
  
  public init(
    sender: Any? = nil,
    description: String?,
    extraDebugValues: Dictionary<String, Any>? = nil,
    extraDebugInfo: String? = nil,
    fileName: String = #file,
    lineNumber: Int = #line,
    columnNumber: Int = #column,
    functionName: String = #function,
    stackTrace: [String]? = Self.shouldLogStackTrace
      ? Thread.callStackSymbols
      : nil
  ) {
  
    if let sender = sender {
      let senderType = type(of: sender);
      self.senderTypeString = String(describing: senderType);
    };
  
    self.description = description;
    
    self.extraDebugValues = extraDebugValues;
    self.extraDebugInfo = extraDebugInfo;
    
    self.filePath = fileName;
    self.lineNumber = lineNumber;
    self.columnNumber = columnNumber;
    self.functionName = functionName;
    
    self.stackTrace = stackTrace;
  };
  
  public init(
    sender: Any? = nil,
    errorCode: Code,
    description: String? = nil,
    extraDebugValues: Dictionary<String, Any>? = nil,
    extraDebugInfo: String? = nil,e
    fileName: String = #file,
    lineNumber: Int = #line,
    columnNumber: Int = #column,
    functionName: String = #function,
    stackTrace: [String]? = Self.shouldLogStackTrace
      ? Thread.callStackSymbols
      : nil
  ) {
    
    self.init(
      sender: sender,
      description: description ?? errorCode.description,
      extraDebugValues: extraDebugValues,
      extraDebugInfo: extraDebugInfo,
      fileName: fileName,
      lineNumber: lineNumber,
      columnNumber: columnNumber,
      functionName: functionName,
      stackTrace: stackTrace
    );
    
    self.errorCode = errorCode;
  };
  
  // MARK: - Functions
  // -----------------
  
  public func log(){
    #if DEBUG
    guard let errorDescription = self.errorDescription else { return };
    print("Error -", errorDescription);
    #endif
  };
};
