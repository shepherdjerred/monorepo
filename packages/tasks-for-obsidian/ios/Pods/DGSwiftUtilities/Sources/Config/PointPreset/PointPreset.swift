//
//  PointPreset.swift
//  
//
//  Created by Dominic Go on 6/21/24.
//

import Foundation
import CoreGraphics

public enum PointPreset: String, CaseIterable {
  
  case topLeft, topCenter, topRight;
  case centerLeft, center, centerRight;
  case bottomLeft, bottomCenter, bottomRight;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var preset: (
    x: HorizontalPointPreset,
    y: VerticalPointPreset
  ) {
    switch self {
      case .topCenter:
        return (.center, .top);
        
      case .bottomCenter:
        return (.center, .bottom);
        
      case .centerLeft:
        return (.right, .center);
        
      case .centerRight:
        return (.left, .center);
        
      case .topLeft:
        return (.left, .top);
        
      case .topRight:
        return (.right, .top);
        
      case .bottomLeft:
        return (.left, .bottom);
        
      case .bottomRight:
        return (.right, .bottom);
        
      case .center:
        return (.center, .center);
    };
  };
    
  public var point: CGPoint {
    .init(
      x: self.preset.x.value,
      y: self.preset.y.value
    );
  };
  
  // MARK: - Init
  // ------------
  
  init(
    xPreset: HorizontalPointPreset,
    yPreset: VerticalPointPreset
  ) {
    switch (xPreset, yPreset){
      case (.left, .top):
        self = .topLeft;
      
      case (.left, .center):
        self = .centerLeft;
        
      case (.left, .bottom):
        self = .bottomLeft;
        
      case (.center, .top):
        self = .topCenter;
      
      case (.center, .center):
        self = .center;
        
      case (.center, .bottom):
        self = .bottomCenter;
        
      case (.right, .top):
        self = .topLeft;
        
      case (.right, .center):
        self = .centerRight;
        
      case (.right, .bottom):
        self = .bottomRight;
    };
  };
  
  // MARK: - Functions
  // -----------------
  
  public func applyTo(point targetPoint: CGPoint) -> CGPoint {
    .init(
      x: targetPoint.x * self.point.x,
      y: targetPoint.y * self.point.y
    );
  };
};

