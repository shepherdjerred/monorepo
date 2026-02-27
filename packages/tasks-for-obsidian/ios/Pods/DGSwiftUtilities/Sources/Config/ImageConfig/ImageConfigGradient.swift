//
//  ImageConfigGradient.swift
//  
//
//  Created by Dominic Go on 6/20/24.
//

import UIKit

public struct ImageConfigGradient: ImageConfigWithSize {
  
  public static let imageType = "imageGradient";

  // MARK: - Properties
  // ------------------
  
  public var type: CAGradientLayerType;
  
  public var colors: [CGColor];
  public var locations: [NSNumber]?;
  
  public var startPoint: CGPoint;
  public var endPoint: CGPoint;
  public var size: CGSize;
  
  public var cornerRadius: CGFloat;
  
  public var isImageLoading = false;
  public var cachedImage: UIImage?;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var gradientLayer: CALayer {
    let layer = CAGradientLayer();
    
    layer.type = self.type;
    layer.colors = self.colors;
    layer.locations = self.locations;
    layer.startPoint = self.startPoint;
    layer.endPoint = self.endPoint;
    layer.cornerRadius = self.cornerRadius;
    
    return layer;
  };
  
  // MARK: - Init
  // ------------
  
  public init(
    type: CAGradientLayerType = .axial,
    colors: [UIColor],
    locations: [NSNumber]? = nil,
    startPointPreset: PointPreset = .top,
    endPointPreset: PointPreset = .bottom,
    cornerRadius: CGFloat = 0,
    size: CGSize
  ){
    
    self.type = type;
    
    self.colors = colors.map {
      $0.cgColor;
    };
    
    self.locations = locations;
    self.startPoint = startPointPreset.point;
    self.endPoint = endPointPreset.point;
    self.size = size;
    self.cornerRadius = cornerRadius;
  };
  
  public init(
    type: CAGradientLayerType,
    colors: [CGColor],
    locations: [NSNumber]? = nil,
    startPoint: CGPoint,
    endPoint: CGPoint,
    size: CGSize,
    cornerRadius: CGFloat
  ) {
    self.type = type;
    self.colors = colors;
    self.locations = locations;
    self.startPoint = startPoint;
    self.endPoint = endPoint;
    self.size = size;
    self.cornerRadius = cornerRadius;
  }
  
  // MARK: - Functions
  // -----------------
  
  public func makeImage() throws -> UIImage {
    return UIGraphicsImageRenderer(size: self.size).image { context in
      let rect = CGRect(origin: .zero, size: self.size);
      
      let gradient = self.gradientLayer;
      gradient.frame = rect;
      gradient.render(in: context.cgContext);
      
      let clipPath = UIBezierPath(
        roundedRect : rect,
        cornerRadius: self.cornerRadius
      );
      
      clipPath.addClip();
    };
  };
};

// MARK: - Static Alias
// --------------------

extension ImageConfigGradient {

  public static func topDownGradient(
    colors: [UIColor],
    locations: [NSNumber]? = nil,
    cornerRadius: CGFloat = 0,
    size: CGSize
  ) -> Self {
    .init(
      type: .axial,
      colors: colors,
      locations: locations,
      startPointPreset: .top,
      endPointPreset: .bottom,
      cornerRadius: cornerRadius,
      size: size
    );
  };
  
  public static func bottomToTopGradient(
    colors: [UIColor],
    locations: [NSNumber]? = nil,
    cornerRadius: CGFloat = 0,
    size: CGSize
  ) -> Self {
    .init(
      type: .axial,
      colors: colors,
      locations: locations,
      startPointPreset: .bottom,
      endPointPreset: .top,
      cornerRadius: cornerRadius,
      size: size
    );
  };
  
  public static func leftToRightGradient(
    colors: [UIColor],
    locations: [NSNumber]? = nil,
    cornerRadius: CGFloat = 0,
    size: CGSize
  ) -> Self {
    .init(
      type: .axial,
      colors: colors,
      locations: locations,
      startPointPreset: .left,
      endPointPreset: .right,
      cornerRadius: cornerRadius,
      size: size
    );
  };
  
  public static func rightToLeftGradient(
    colors: [UIColor],
    locations: [NSNumber]? = nil,
    cornerRadius: CGFloat = 0,
    size: CGSize
  ) -> Self {
    .init(
      type: .axial,
      colors: colors,
      locations: locations,
      startPointPreset: .right,
      endPointPreset: .left,
      cornerRadius: cornerRadius,
      size: size
    );
  };
};

// MARK: - ImageConfigGradient+Equatable
// -------------------------------------

extension ImageConfigGradient: Equatable {
  
  public static func ==(lhs: Self, rhs: Self) -> Bool {
       lhs.type         == rhs.type
    && lhs.colors       == rhs.colors
    && lhs.locations    == rhs.locations
    && lhs.startPoint   == rhs.startPoint
    && lhs.endPoint     == rhs.endPoint
    && lhs.size         == rhs.size
    && lhs.cornerRadius == rhs.cornerRadius;
  };
};
