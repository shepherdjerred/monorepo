//
//  AuxiliaryPreviewTransitionKeyframeConfig.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import UIKit
import DGSwiftUtilities


public struct AuxiliaryPreviewTransitionKeyframeConfig {

  static var defaultEndKeyframe: Self = .init(
    opacity: 1,
    transform: .default
  );

  static var propertyKeys: [PartialKeyPath<Self>] = [
    \.opacity,
    \.transform,
    \.auxiliaryPreviewPreferredWidth,
    \.auxiliaryPreviewPreferredHeight,
  ];

  public var opacity: CGFloat?;
  public var transform: Transform3D?;
  
  public var auxiliaryPreviewPreferredWidth: AuxiliaryPreviewSizeValue?;
  public var auxiliaryPreviewPreferredHeight: AuxiliaryPreviewSizeValue?;
  
  public init(
    opacity: CGFloat? = nil,
    transform: Transform3D? = nil,
    auxiliaryPreviewPreferredWidth: AuxiliaryPreviewSizeValue? = nil,
    auxiliaryPreviewPreferredHeight: AuxiliaryPreviewSizeValue? = nil
  ) {
  
    self.opacity = opacity;
    self.transform = transform;
    self.auxiliaryPreviewPreferredWidth = auxiliaryPreviewPreferredWidth;
    self.auxiliaryPreviewPreferredHeight = auxiliaryPreviewPreferredHeight;
  }
  
  mutating func setNonNilValues(using newValue: Self){
    Self.propertyKeys.forEach {
      guard $0 is ExpressibleByNilLiteral,
            let optionalValue = $0 as? OptionalUnwrappable,
            !optionalValue.isSome()
      else { return };

      switch $0 {
        case let key as WritableKeyPath<Self, Bool?>:
          self[keyPath: key] = newValue[keyPath: key];
      
        case let key as WritableKeyPath<Self, CGFloat?>:
          self[keyPath: key] = newValue[keyPath: key];
        
        case let key as WritableKeyPath<Self, UIColor?>:
          self[keyPath: key] = newValue[keyPath: key];
          
        case let key as WritableKeyPath<Self, CGSize?>:
          self[keyPath: key] = newValue[keyPath: key];
          
        case let key as WritableKeyPath<Self, CACornerMask?>:
          self[keyPath: key] = newValue[keyPath: key];
          
        case let key as WritableKeyPath<Self, UIVisualEffect?>:
          self[keyPath: key] = newValue[keyPath: key];
          
        case let key as WritableKeyPath<Self, Transform3D?>:
          guard let otherValue = newValue[keyPath: key] else { break };
          self[keyPath: key]?.setNonNilValues(with: otherValue);

        default:
          break;
      };
    };
  };
};
