//
//  LoadingState.swift
//  
//
//  Created by Dominic Go on 8/5/24.
//

import Foundation


public enum LoadingState {
  
  case notLoaded;
  case loading;
  case loaded;
  case failed(error: Error?);
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var isLoading: Bool {
    self == .loading;
  };
  
  public var isLoaded: Bool {
    self == .loaded;
  };
  
  public var error: Error? {
    switch self {
      case let .failed(error):
        return error;
        
      default:
        return nil;
    };
  };
  
  public var didLoadingFail: Bool {
    switch self {
      case .failed:
        return true;
        
      default:
        return false;
    };
  };
  
  public var shouldLoad: Bool {
    self == .notLoaded || self.didLoadingFail;
  };
};

// MARK: - EnumCaseStringRepresentable+Equatable
// ---------------------------------------------

extension LoadingState: EnumCaseStringRepresentable {

  public var caseString: String {
    switch self {
      case .notLoaded:
        return "notLoaded";
        
      case .loading:
        return "loading";
        
      case .loaded:
        return "loaded";
        
      case .failed:
        return "failed";
    };
  };
};


// MARK: - LoadingState+Equatable
// ------------------------------

extension LoadingState: Equatable {
  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.caseString == rhs.caseString;
  };
};
