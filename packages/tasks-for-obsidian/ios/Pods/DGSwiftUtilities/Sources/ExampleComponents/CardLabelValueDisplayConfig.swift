//
//  CardLabelValueDisplayConfig.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/15/24.
//

import UIKit


public struct CardLabelValueDisplayConfig {
  
  public var items: [CardLabelValueDisplayItemConfig];
  public var colorThemeConfig: ColorThemeConfig;
  
  public var margins: UIEdgeInsets;
  
  public var shouldUseThemeForBackgroundColor: Bool;
  
  public init(
    items: [CardLabelValueDisplayItemConfig],
    colorThemeConfig: ColorThemeConfig,
    margins: UIEdgeInsets? = nil,
    shouldUseThemeForBackgroundColor: Bool = true
  ) {
    self.items = items;
    self.colorThemeConfig = colorThemeConfig;
    self.margins = margins ?? .init(
      top: 0,
      left: 8,
      bottom: 0,
      right: 8
    );
    
    self.shouldUseThemeForBackgroundColor = shouldUseThemeForBackgroundColor;
  };
  
  public init(
    items: [CardLabelValueDisplayItemConfig],
    deriveColorThemeConfigFrom colorThemeConfig: ColorThemeConfig,
    margins: UIEdgeInsets? = nil,
    shouldUseThemeForBackgroundColor: Bool = true
  ) {
    self.items = items;
    var colorThemeConfig = colorThemeConfig;
    
    colorThemeConfig.colorBgLight =
      colorThemeConfig.colorBgDark.withAlphaComponent(0.15);
      
    colorThemeConfig.colorBgDark =
      colorThemeConfig.colorBgDark.withAlphaComponent(0.7);

    self.colorThemeConfig = colorThemeConfig;
    
    self.margins = margins ?? .init(
      top: 0,
      left: 8,
      bottom: 0,
      right: 8
    );
    
    self.shouldUseThemeForBackgroundColor = shouldUseThemeForBackgroundColor;
  };
  
  public func createView() -> UIView {
    let rootVStack = {
      let stack = UIStackView();
      
      stack.axis = .vertical;
      stack.distribution = .fill;
      stack.alignment = .fill;
      
      if self.shouldUseThemeForBackgroundColor {
        stack.backgroundColor = self.colorThemeConfig.colorBgLight;
      };
      
      stack.clipsToBounds = true;
      stack.layer.cornerRadius = 8;
      stack.layer.maskedCorners = .allCorners;
      
      stack.isLayoutMarginsRelativeArrangement = true;
      stack.layoutMargins = self.margins;
                
      return stack;
    }();
    
    for itemConfig in self.items {
      let itemView =
        itemConfig.createView(colorThemeConfig: self.colorThemeConfig);
        
      rootVStack.addArrangedSubview(itemView);
    };
    
    return rootVStack;
  };
};

// MARK: - CardLabelValueDisplayConfig+StaticAlias
// -----------------------------------------------

public extension CardLabelValueDisplayConfig {
  
  static func singleRowPlain(
    label: [AttributedStringConfig],
    value: [AttributedStringConfig],
    colorThemeConfig: ColorThemeConfig
  ) -> Self {
    
    .init(
      items: [
        .singleRow(label: label, value: value),
      ],
      colorThemeConfig: colorThemeConfig,
      margins: .zero,
      shouldUseThemeForBackgroundColor: false
    );
  };
};
