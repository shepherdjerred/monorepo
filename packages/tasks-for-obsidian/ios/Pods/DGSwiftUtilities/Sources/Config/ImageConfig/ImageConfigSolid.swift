//
//  ImageConfigSolid.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/10/24.
//

import UIKit


public struct ImageConfigSolid: ImageConfigWithSize {
  
  public static let imageType = "imageSolid";

  // MARK: - Properties
  // ------------------

  public var size: CGSize;
  public var fillColor: UIColor;
  public var borderRadius: CGFloat;
  
  public var isImageLoading: Bool = false;
  public var cachedImage: UIImage?;
  
  // MARK: - Init
  // ------------
  
  public init(
    size: CGSize,
    fillColor: UIColor,
    borderRadius: CGFloat
  ) {
    self.size = size;
    self.fillColor = fillColor;
    self.borderRadius = borderRadius;
  };
  
  public init(fillColor: UIColor) {
    self.size = .init(width: 1, height: 1);
    self.fillColor = fillColor;
    self.borderRadius = 0;
  };
  
  // MARK: - Functions
  // -----------------

  public func makeImage() -> UIImage {
    return UIGraphicsImageRenderer(size: self.size).image { context in
      let rect = CGRect(origin: .zero, size: self.size);
      
      let clipPath = UIBezierPath(
        roundedRect : rect,
        cornerRadius: self.borderRadius
      );
      
      clipPath.addClip();
      self.fillColor.setFill();
      
      context.fill(rect);
    };
  };
};

// MARK: - ImageConfigSolid+Equatable
// ----------------------------------

extension ImageConfigSolid: Equatable {
  
  public static func ==(lhs: Self, rhs: Self) -> Bool {
       lhs.size         == rhs.size
    && lhs.fillColor    == rhs.fillColor
    && lhs.borderRadius == rhs.borderRadius;
  };
};
