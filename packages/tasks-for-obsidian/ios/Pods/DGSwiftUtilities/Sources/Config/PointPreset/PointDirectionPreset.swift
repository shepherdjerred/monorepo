//
//  PointDirectionPreset.swift
//  
//
//  Created by Dominic Go on 6/20/24.
//

import UIKit

public enum PointDirectionPreset: String, CaseIterable {

  // horizontal
  case centerLeftToCenterRight, centerRightToCenterLeft;
  
  // vertical
  case centerTopToCenterBottom, centerBottomToCenterTop;
  
  // diagonal
  case topLeftToBottomRight, topRightToBottomLeft;
  case bottomLeftToTopRight, bottomRightToTopLeft;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var pointPreset: (
    start: PointPreset,
    end: PointPreset
  ) {
    switch self {
      case .centerLeftToCenterRight:
        return (.centerLeft, .centerRight);
        
      case .centerRightToCenterLeft:
        return (.centerRight, .centerLeft);
        
      case .centerTopToCenterBottom:
        return (.topCenter, .bottomCenter);
        
      case .centerBottomToCenterTop:
        return (.bottomCenter, .topCenter);
        
      case .topLeftToBottomRight:
        return (.topLeft, .bottomRight);
        
      case .topRightToBottomLeft:
        return (.topRight, .bottomLeft);
        
      case .bottomLeftToTopRight:
        return (.bottomLeft, .topRight);
        
      case .bottomRightToTopLeft:
        return (.bottomRight, .topLeft);
    };
  };
  
  public var point: (start: CGPoint, end: CGPoint) {
    return (
      start: self.pointPreset.start.point,
      end: self.pointPreset.end.point
    );
  };
};

