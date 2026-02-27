//
//  Transform3D.swift
//  
//
//  Created by Dominic Go on 8/7/23.
//

import QuartzCore


//  CGAffineTransform
//
//  | a  b  0 |
//  | c  d  0 | =
//  | tx ty 1 |
//
// |------------------ CGAffineTransformComponents ----------------|
// | sx 0   0 |   | 1   0  0 |   |  cos(t)  sin(t) 0 |   | 1  0  0 |
// | 0  sy  0 | * | sh  1  0 | * | -sin(t)  cos(t) 0 | * | 0  1  0 |
// | 0  0   1 |   | 0   0  1 |   |  0       0      1 |   | tx ty 1 |
//    scale           shear            rotation          translation

/// [m11, m12, m13, m14]
/// [m21, m22, m23, m24]
/// [m31, m32, m33, m34]
/// [m41, m42, m43, m44]
///
/// m11 - scale x
/// m12 - shear y
/// m13 - ?
/// m14 - a,c
///
/// m21 - shear x
/// m22 - scale y
/// m23 - ?
/// m24 - a,b
///
/// m31 - ?
/// m32 - ?
/// m33 - ?
/// m34 - perspective
///
/// m41 - translate x
/// m42 - translate y
/// m43 - ?
/// m44 - ?


public struct Transform3D: Equatable, MutableReference {
  
  static let keys: [PartialKeyPath<Self>] = [
    \._translateX,
    \._translateY,
    \._translateZ,
    \._scaleX,
    \._scaleY,
    \._rotateX,
    \._rotateY,
    \._rotateZ,
    \._perspective,
    \._skewX,
    \._skewY,
  ];
  
  // MARK: - Properties
  // ------------------
  
  private var _translateX: CGFloat?;
  private var _translateY: CGFloat?;
  private var _translateZ: CGFloat?;
  
  private var _scaleX: CGFloat?;
  private var _scaleY: CGFloat?;
  
  private var _rotateX: Angle<CGFloat>?;
  private var _rotateY: Angle<CGFloat>?;
  private var _rotateZ: Angle<CGFloat>?;
  
  private var _perspective: CGFloat?;
  
  private var _skewX: CGFloat?;
  private var _skewY: CGFloat?;
  
  // MARK: - Computed Properties - Setters/Getters
  // ---------------------------------------------

  public var translateX: CGFloat {
    get {
      self._translateX
        ?? Self.identity.translateX;
    }
    set {
      self._translateX = newValue;
    }
  };
  
  public var translateY: CGFloat {
    get {
      self._translateY
        ?? Self.identity.translateY;
    }
    set {
      self._translateY = newValue;
    }
  };
  
  public var translateZ: CGFloat {
    get {
      self._translateZ
        ?? Self.identity.translateZ;
    }
    set {
      self._translateZ = newValue;
    }
  };
  
  public var scaleX: CGFloat {
    get {
      self._scaleX
        ?? Self.identity.scaleX;
    }
    set {
      self._scaleX = newValue;
    }
  };
  
  public var scaleY: CGFloat {
    get {
      self._scaleY
        ?? Self.identity.scaleY;
    }
    set {
      self._scaleY = newValue;
    }
  };
  
  public var rotateX: Angle<CGFloat> {
    get {
      self._rotateX ??
        Self.identity.rotateX;
    }
    set {
      self._rotateX = newValue;
    }
  };
  
  public var rotateY: Angle<CGFloat> {
    get {
      self._rotateY ??
        Self.identity.rotateY;
    }
    set {
      self._rotateY = newValue;
    }
  };
  
  public var rotateZ: Angle<CGFloat> {
    get {
      self._rotateZ ??
        Self.identity.rotateZ;
    }
    set {
      self._rotateZ = newValue;
    }
  };
  
  public var perspective: CGFloat {
    get {
      self._perspective
        ?? Self.identity.perspective;
    }
    set {
      self._perspective = newValue;
    }
  };
  
  public var skewX: CGFloat {
    get {
      self._skewX
        ?? Self.identity.skewX;
    }
    set {
      self._skewX = newValue;
    }
  };
  
  public var skewY: CGFloat {
    get {
      self._skewY
        ?? Self.identity.skewY;
    }
    set {
      self._skewY = newValue;
    }
  };
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var isIdentity: Bool {
    CATransform3DIsIdentity(self.transform3D);
  };
  
  public var isAffine: Bool {
    CATransform3DIsAffine(self.transform3D);
  };
  
  public var transform3D: CATransform3D {
    var transform = CATransform3DIdentity;
    
    transform.m34 = self.perspective;
    transform.m12 = self.skewY;
    transform.m21 = self.skewX;
    
    transform = CATransform3DTranslate(
      transform,
      self.translateX,
      self.translateY,
      self.translateZ
    );
    
    transform = CATransform3DScale(
      transform,
      self.scaleX,
      self.scaleY,
      1
    );
    
    transform = CATransform3DRotate(
      transform,
      self.rotateX.radians,
      1,
      0,
      0
    );
    
    transform = CATransform3DRotate(
      transform,
      self.rotateY.radians,
      0,
      1,
      0
    );
    
    transform = CATransform3DRotate(
      transform,
      self.rotateZ.radians,
      0,
      0,
      1
    );
    
    return transform;
  };
  
  public var invertedTransform3D: CATransform3D {
    CATransform3DInvert(self.transform3D);
  };
  
  public var affineTransform: CGAffineTransform {
    CATransform3DGetAffineTransform(self.transform3D);
  };
  
  public var isAllValueSet: Bool {
    Self.keys.allSatisfy {
      let value = self[keyPath: $0];
      
      guard value is ExpressibleByNilLiteral,
            let optionalValue = value as? OptionalUnwrappable
      else { return false };
      
      return optionalValue.isSome();
    };
  };
  
  // MARK: - Init
  // ------------
  
  public init(
    translateX: CGFloat? = nil,
    translateY: CGFloat? = nil,
    translateZ: CGFloat? = nil,
    scaleX: CGFloat? = nil,
    scaleY: CGFloat? = nil,
    rotateX: Angle<CGFloat>? = nil,
    rotateY: Angle<CGFloat>? = nil,
    rotateZ: Angle<CGFloat>? = nil,
    perspective: CGFloat? = nil,
    skewX: CGFloat? = nil,
    skewY: CGFloat? = nil
  ) {
    
    self._translateX = translateX;
    self._translateY = translateY;
    self._translateZ = translateZ;
    
    self._scaleX = scaleX;
    self._scaleY = scaleY;
    
    self._rotateX = rotateX;
    self._rotateY = rotateY;
    self._rotateZ = rotateZ;
    
    self._perspective = perspective;
    self._skewX = skewX;
    self._skewY = skewY;
  };
  
  public init(
    translateX: CGFloat,
    translateY: CGFloat,
    translateZ: CGFloat,
    scaleX: CGFloat,
    scaleY: CGFloat,
    rotateX: Angle<CGFloat>,
    rotateY: Angle<CGFloat>,
    rotateZ: Angle<CGFloat>,
    perspective: CGFloat,
    skewX: CGFloat,
    skewY: CGFloat
  ) {
    
    self._translateX = translateX;
    self._translateY = translateY;
    self._translateZ = translateZ;
    
    self._scaleX = scaleX;
    self._scaleY = scaleY;
    
    self._rotateX = rotateX;
    self._rotateY = rotateY;
    self._rotateZ = rotateZ;
    
    self._perspective = perspective;
    self._skewX = skewX;
    self._skewY = skewY;
  };
  
  // MARK: - Functions
  // -----------------
  
  public mutating func setNonNilValues(with otherValue: Self) {
    Self.keys.forEach {
      let value = self[keyPath: $0];
      
      guard value is ExpressibleByNilLiteral,
            let optionalValue = value as? OptionalUnwrappable,
            !optionalValue.isSome()
      else { return };
    
      switch $0 {
        case let key as WritableKeyPath<Self, CGFloat>:
          self[keyPath: key] = otherValue[keyPath: key];
          
        case let key as WritableKeyPath<Self, Angle<CGFloat>>:
         self[keyPath: key] = otherValue[keyPath: key];
          
        default:
          break;
      };
    };
  };
  
  public mutating func append(otherTransform: Self) {
    Self.keys.forEach {
      let value = self[keyPath: $0];
      
      let isCurrentValueNil: Bool = {
        guard value is ExpressibleByNilLiteral,
            let optionalValue = value as? OptionalUnwrappable,
            !optionalValue.isSome()
        else {
          return true;
        };
        
        return false;
      }();
      
      switch $0 {
        case let key as WritableKeyPath<Self, CGFloat>:
          let otherValue = otherTransform[keyPath: key];
          
          guard !isCurrentValueNil else {
            self[keyPath: key] = otherValue;
            break;
          };
          
          let currentValue = self[keyPath: key];
          self[keyPath: key] = currentValue + otherValue;
          
        case let key as WritableKeyPath<Self, Angle<CGFloat>>:
          let otherValueRaw = otherTransform[keyPath: key];
          
          guard !isCurrentValueNil else {
            self[keyPath: key] = otherValueRaw;
            break;
          };
          
          let currentValue = self[keyPath: key];
          
          /// preserve/respect current angle unit
          let otherValue = currentValue.asSameUnit(otherAngle: otherValueRaw);
          let newValueRaw = currentValue.rawValue + otherValue.rawValue;
          let newValue = currentValue.wrap(otherValue: newValueRaw);
          
          self[keyPath: key] = newValue;
          
        default:
          break;
      };
    };
  };
  
  // MARK: - Chain Functions
  // -----------------------
  
  @discardableResult
  public func withTranslateX(_ value: CGFloat) -> Self {
    var copy = self;
    copy.translateX = value;
    return copy;
  };
  
  @discardableResult
  public func withTranslateY(_ value: CGFloat) -> Self {
    var copy = self;
    copy.translateY = value;
    return copy;
  };
  
  @discardableResult
  public func withTranslateZ(_ value: CGFloat) -> Self {
    var copy = self;
    copy.translateZ = value;
    return copy;
  };
  
  @discardableResult
  public func withScaleX(_ value: CGFloat) -> Self {
    var copy = self;
    copy.scaleX = value;
    return copy;
  };
  
  @discardableResult
  public func withScaleY(_ value: CGFloat) -> Self {
    var copy = self;
    copy.scaleY = value;
    return copy;
  };
  
  @discardableResult
  public func withRotateX(_ angle: Angle<CGFloat>) -> Self {
    var copy = self;
    copy.rotateX = angle;
    return copy;
  };
  
  @discardableResult
  public func withRotateY(_ angle: Angle<CGFloat>) -> Self {
    var copy = self;
    copy.rotateY = angle;
    return copy;
  };
  
  @discardableResult
  public func withRotateZ(_ angle: Angle<CGFloat>) -> Self {
    var copy = self;
    copy.rotateZ = angle;
    return copy;
  };
  
  @discardableResult
  public func withPerspective(_ value: CGFloat) -> Self {
    var copy = self;
    copy.perspective = value;
    return copy;
  };
  
  @discardableResult
  public func withSkewX(_ value: CGFloat) -> Self {
    var copy = self;
    copy.skewX = value;
    return copy;
  };
  
  @discardableResult
  public func withSkewY(_ value: CGFloat) -> Self {
    var copy = self;
    copy.skewY = value;
    return copy;
  };
};

// MARK: Transform3D+StaticAlias
// -----------------------------

public extension Transform3D {
  
  static let identity: Self = .init(
    translateX: 0,
    translateY: 0,
    translateZ: 0,
    scaleX: 1,
    scaleY: 1,
    rotateX: .zero,
    rotateY: .zero,
    rotateZ: .zero,
    perspective: 0,
    skewX: 0,
    skewY: 0
  );

  static func translateX(_ value: CGFloat) -> Self {
    .init(translateX: value);
  };
  
  static func translateY(_ value: CGFloat) -> Self {
    .init(translateY: value);
  };
  
  static func translateZ(_ value: CGFloat) -> Self {
    .init(translateZ: value);
  };
  
  static func scaleX(_ value: CGFloat) -> Self {
    .init(scaleX: value);
  };
  
  static func scaleY(_ value: CGFloat) -> Self {
    .init(scaleY: value);
  };
  
  static func rotateX(_ angle: Angle<CGFloat>) -> Self {
    .init(rotateX: angle);
  };
  
  static func rotateY(_ angle: Angle<CGFloat>) -> Self {
    .init(rotateY: angle);
  };
  
  static func rotateZ(_ angle: Angle<CGFloat>) -> Self {
    .init(rotateZ: angle);
  };
  
  static func perspective(_ value: CGFloat) -> Self {
    .init(perspective: value);
  };
  
  static func skewX(_ value: CGFloat) -> Self {
    .init(skewX: value);
  };
  
  static func skewY(_ value: CGFloat) -> Self {
    .init(skewY: value);
  };
};

// MARK: - UnsafeMutablePointer+Transform3D
// ----------------------------------------

/// for adj. values w/o making temp in-between copies
///
/// example usage:
/// ```
/// var trans: Transform3D = .init();
///
/// trans.mutableRef()
///   .withTranslateX(90)
///   .withScaleY(3);
/// ```
public extension UnsafeMutablePointer<Transform3D> {
  
  @discardableResult
  func withTranslateX(_ value: CGFloat) -> Self {
    self.pointee.translateX = value;
    return self;
  };
  
  @discardableResult
  func withTranslateY(_ value: CGFloat) -> Self {
    self.pointee.translateY = value;
    return self;
  };
  
  @discardableResult
  func withTranslateZ(_ value: CGFloat) -> Self {
    self.pointee.translateZ = value;
    return self;
  };
  
  @discardableResult
  func withScaleX(_ value: CGFloat) -> Self {
    self.pointee.scaleX = value;
    return self;
  };
  
  @discardableResult
  func withScaleY(_ value: CGFloat) -> Self {
    self.pointee.scaleY = value;
    return self;
  };
  
  @discardableResult
  func withRotateX(_ angle: Angle<CGFloat>) -> Self {
    self.pointee.rotateX = angle;
    return self;
  };
  
  @discardableResult
  func withRotateY(_ angle: Angle<CGFloat>) -> Self {
    self.pointee.rotateY = angle;
    return self;
  };
  
  @discardableResult
  func withRotateZ(_ angle: Angle<CGFloat>) -> Self {
    self.pointee.rotateZ = angle;
    return self;
  };
  
  @discardableResult
  func withPerspective(_ value: CGFloat) -> Self {
    self.pointee.perspective = value;
    return self;
  };
  
  @discardableResult
  func withSkewX(_ value: CGFloat) -> Self {
    self.pointee.skewX = value;
    return self;
  };
  
  @discardableResult
  func withSkewY(_ value: CGFloat) -> Self {
    self.pointee.skewY = value;
    return self;
  };
};
