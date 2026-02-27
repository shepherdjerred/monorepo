//
//  AnimationConfig+CustomStringConvertible.swift
//
//
//  Created by Dominic Go on 11/15/23.
//


extension AnimationConfig: CustomStringConvertible {
  public var description: String {
    switch self {
      case .animator:
        return "animator";
        
      case .presetCurve:
        return "presetCurve";
        
      case .presetSpring:
        return "presetSpring";
        
      case .bezierCurve:
        return "bezierCurve";
        
      case .springDamping:
        return "springDamping";
        
      case .springPhysics:
        return "springPhysics";
        
      case .springGesture:
        return "springGesture";
        
    };
  };
};
