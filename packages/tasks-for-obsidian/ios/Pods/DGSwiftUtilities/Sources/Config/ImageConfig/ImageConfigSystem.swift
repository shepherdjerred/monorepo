//
//  ImageConfigSystem.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/8/24.
//

import UIKit


@available(iOS 13.0, *)
public struct ImageConfigSystem: ImageConfig {

  public static let imageType = "imageSystem";

  public enum ColorType: Equatable {
    case hierarchicalColor(UIColor);
    case paletteColors([UIColor]);
    case tintColor(UIColor);
  };
  
  // MARK: - Properties
  // ------------------

  public var systemName: String;
  
  public var pointSize: CGFloat?;
  public var weight: UIImage.SymbolWeight?;
  public var scale: UIImage.SymbolScale?;
  
  public var color: ColorType?;
  
  public var isImageLoading: Bool = false;
  public var cachedImage: UIImage?;
  
  // MARK: - Computed Properties
  // ---------------------------

  public var symbolConfigs: [UIImage.SymbolConfiguration] {
    var configs: [UIImage.SymbolConfiguration] = [];
    
    if let pointSize = self.pointSize {
      configs.append( .init(pointSize: pointSize) );
    };
    
    if let weight = self.weight {
      configs.append( .init(weight: weight) );
    };
    
    if let scale = self.scale {
      configs.append( .init(scale: scale) );
    };
    
    #if swift(>=5.5)
    switch self.color {
      case let .hierarchicalColor(color):
        guard #available(iOS 15.0, *) else { break };
        configs.append(
          .init(hierarchicalColor: color)
        );
        
      case let .paletteColors(colors):
        guard #available(iOS 15.0, *) else { break };
        configs.append(
          .init(paletteColors: colors)
        );
        
      default:
        break;
    };
    #endif
    
    return configs;
  };
  
  public var symbolConfig: UIImage.SymbolConfiguration? {
    var combinedConfig: UIImage.SymbolConfiguration?;
    
    for config in symbolConfigs {
      if let prevCombinedConfig = combinedConfig {
        combinedConfig = prevCombinedConfig.applying(config);
        
      } else {
        combinedConfig = config;
      };
    };
    
    return combinedConfig;
  };
  
  public var baseImage: UIImage? {
    if let symbolConfig = symbolConfig {
      return UIImage(
        systemName: self.systemName,
        withConfiguration: symbolConfig
      );
    };
    
    return UIImage(systemName: self.systemName);
  };
  
  public init(
    systemName: String,
    pointSize: CGFloat? = 16,
    weight: UIImage.SymbolWeight? = .regular,
    scale: UIImage.SymbolScale? = .default,
    color: ColorType? = nil
  ) {
    self.systemName = systemName;
    self.pointSize = pointSize;
    self.weight = weight;
    self.scale = scale;
    self.color = color;
  };
  
  public func makeImage() throws -> UIImage {
    guard let image = self.baseImage else {
      throw GenericError(
        errorCode: .unexpectedNilValue,
        description: "Unable to create baseImage"
      );
    };
    
    switch self.color {
      case let .tintColor(color):
        return image.withTintColor(
          color,
          renderingMode: .alwaysOriginal
        );
        
      default:
        return image;
    };
  }
};

// MARK: - ImageConfigSystem+Equatable
// -----------------------------------

@available(iOS 13.0, *)
extension ImageConfigSystem: Equatable {
  
  public static func ==(lhs: Self, rhs: Self) -> Bool {
       lhs.systemName == rhs.systemName
    && lhs.pointSize  == rhs.pointSize
    && lhs.weight     == rhs.weight
    && lhs.scale      == rhs.scale
    && lhs.color      == rhs.color;
  };
};
