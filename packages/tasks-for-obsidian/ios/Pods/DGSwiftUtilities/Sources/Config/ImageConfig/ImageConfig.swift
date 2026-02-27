//
//  ImageConfig.swift
//  
//
//  Created by Dominic Go on 7/28/24.
//

import UIKit


public protocol ImageConfig {

  static var imageType: String { get };
  
  var isImageLoading: Bool { get set };
  
  var cachedImage: UIImage? { get set };
  
  mutating func preloadImageIfNeeded() throws;
  
  func makeImage() throws -> UIImage;
};

// MARK: - ImageConfig+Helpers
// ---------------------------

public extension ImageConfig {

  var isImageLoaded: Bool {
    self.cachedImage != nil;
  };
  
  mutating func makeImageIfNeeded() throws -> UIImage {
    if let cachedImage = self.cachedImage {
      return cachedImage;
    };
    
    self.isImageLoading = true;
    
    defer {
      self.isImageLoading = false;
    };
    
    let image = try self.makeImage();
    self.cachedImage = image;
    
    return image;
  };
};

// MARK: - ImageConfig+Default
// ---------------------------

public extension ImageConfig {
  
  mutating func preloadImageIfNeeded() throws {
    guard self.cachedImage == nil else {
      self.isImageLoading = false;
      return;
    };
    
    self.isImageLoading = true;
    
    defer {
      self.isImageLoading = false;
    };
    
    do {
      let image = try self.makeImage();
      self.cachedImage = image;
    
    } catch {
      throw error;
    };
  };
};
