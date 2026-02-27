//
//  ShapeLayerStrokeStyle.swift
//  
//
//  Created by Dominic Go on 11/26/24.
//

import UIKit


public struct ShapeLayerStrokeStyle: Equatable {
  
  public var lineWidth: CGFloat;
  public var strokeColor: UIColor?;
  
  public var linePattern: LineDashPattern;
  public var lineDashPhase: CGFloat;
  
  public var strokeStart: CGFloat;
  public var strokeEnd: CGFloat;
  
  public init(
    lineWidth: CGFloat,
    strokeColor: UIColor?,
    linePattern: LineDashPattern = .noPattern,
    lineDashPhase: CGFloat = 0,
    strokeStart: CGFloat = 0,
    strokeEnd: CGFloat = 1
  ) {
    self.lineWidth = lineWidth;
    self.strokeColor = strokeColor;
    self.linePattern = linePattern;
    self.lineDashPhase = lineDashPhase;
    self.strokeStart = strokeStart;
    self.strokeEnd = strokeEnd;
  };
  
  public func apply(toShape shapeLayer: CAShapeLayer){
    shapeLayer.lineWidth = self.lineWidth;
    shapeLayer.strokeColor = self.strokeColor?.cgColor;
    
    self.linePattern.apply(toShape: shapeLayer);
    shapeLayer.lineDashPhase = self.lineDashPhase;
    
    shapeLayer.strokeStart = self.strokeStart;
    shapeLayer.strokeEnd = self.strokeEnd;
  };
  
  public func createAnimations(
    forShape shapeLayer: CAShapeLayer,
    withPrevStyle prevStyle: Self,
    usingBaseAnimation baseAnimation: CABasicAnimation
  ) -> [CABasicAnimation] {
  
    Self.stylePropertyToLayerKeyPathMap.reduce(into: []) {
      guard shapeLayer.animation(forKey: $1.layerKeyPath) == nil else {
        return;
      };
      
      switch $1.styleKeyPath {
        case let styleKeyPath as KeyPath<Self, CGFloat>:
          let prevValue = prevStyle[keyPath: styleKeyPath];
          let nextValue = self[keyPath: styleKeyPath];
          
          guard nextValue != prevValue else {
            return;
          };
          
          let animation = baseAnimation.copy() as! CABasicAnimation;
          $0.append(animation);
          
          animation.keyPath = $1.layerKeyPath;
          animation.fromValue = prevValue;
          animation.toValue = nextValue;
          
          shapeLayer.setValue(
            nextValue,
            forKeyPath: $1.layerKeyPath
          );
          
          shapeLayer.add(animation, forKey: $1.layerKeyPath);
      
        case let styleKeyPath as KeyPath<Self, UIColor?>:
          let prevValue = prevStyle[keyPath: styleKeyPath];
          let nextValue = self[keyPath: styleKeyPath];
          
          guard nextValue?.components != prevValue?.components else {
            return;
          };
          
          let animation = baseAnimation.copy() as! CABasicAnimation;
          $0.append(animation);
          
          animation.keyPath = $1.layerKeyPath;
          animation.fromValue = prevValue?.cgColor;
          animation.toValue = nextValue?.cgColor;
          
          shapeLayer.setValue(
            nextValue?.cgColor,
            forKeyPath: $1.layerKeyPath
          );
          
          shapeLayer.add(animation, forKey: $1.layerKeyPath);
          
        case let styleKeyPath as KeyPath<Self, LineDashPattern>:
          let prevValue = prevStyle[keyPath: styleKeyPath];
          let nextValue = self[keyPath: styleKeyPath];
          
          guard nextValue.values != prevValue.values else {
            return;
          };
          
          let animation = baseAnimation.copy() as! CABasicAnimation;
          $0.append(animation);
          
          animation.keyPath = $1.layerKeyPath;
          animation.fromValue = prevValue.valuesObjc;
          animation.toValue = nextValue.valuesObjc;
          
          shapeLayer.setValue(
            nextValue.valuesObjc,
            forKeyPath: $1.layerKeyPath
          );
            
          shapeLayer.add(
            animation,
            forKey: $1.layerKeyPath
          );
          
        default:
          #if DEBUG
          assertionFailure(
            "Unimplemented animation key"
            + "\n - for styleKeyPath: \($1.styleKeyPath)"
            + "\n - for layerKeyPath: \($1.layerKeyPath)"
          );
          #endif
          break;
      };
    };
  };
};

// MARK: - ShapeLayerStrokeStyle+StaticAlias
// -----------------------------------------

public extension ShapeLayerStrokeStyle {
  
  static var `default`: Self {
    .init(
      lineWidth: 0,
      strokeColor: nil,
      linePattern: .noPattern,
      lineDashPhase: 0,
      strokeStart: 0,
      strokeEnd: 1
    );
  };
  
  static var noBorder: Self {
    .init(
      lineWidth: 0,
      strokeColor: nil,
      linePattern: .noPattern
    );
  };
};

// MARK: - ShapeLayerStrokeStyle+StaticMembers
// -------------------------------------------

public extension ShapeLayerStrokeStyle {
  
  static var stylePropertyToLayerKeyPathMap: [(
    styleKeyPath: PartialKeyPath<Self>,
    layerKeyPath: String
  )] {
    [
      (
        \.lineWidth,
        #keyPath(CAShapeLayer.lineWidth)
      ),
      (
        \.strokeColor,
        #keyPath(CAShapeLayer.strokeColor)
      ),
      (
        \.linePattern,
        #keyPath(CAShapeLayer.lineDashPattern)
      ),
      (
        \.lineDashPhase,
        #keyPath(CAShapeLayer.lineDashPhase)
      ),
      (
        \.strokeStart,
        #keyPath(CAShapeLayer.strokeStart)
      ),
      (
        \.strokeEnd,
        #keyPath(CAShapeLayer.strokeEnd)
      )
    ];
  };
};
