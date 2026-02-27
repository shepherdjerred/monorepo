//
//  CardLabelValueDisplayItemConfig.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/15/24.
//

import UIKit

public enum CardLabelValueDisplayItemConfig {
  
  public static func singleRowPlain(label: String, value: String) -> Self {
    .singleRow(
      label: [.init(text: label)],
      value: [.init(text: value)]
    );
  };
  
  public static func singleRowPlain(
    label: String,
    value: CustomStringConvertible
  ) -> Self {
    .singleRow(
      label: [.init(text: label)],
      value: [.init(text: value.description)]
    );
  };
  
  public static func singleRowPlain(
    label: String,
    value: CustomDebugStringConvertible
  ) -> Self {
    .singleRow(
      label: [.init(text: label)],
      value: [.init(text: value.debugDescription)]
    );
  };
  
  case singleRow(
    label: [AttributedStringConfig],
    value: [AttributedStringConfig]
  );
  
  case singeRowWithImageValue(
    label: [AttributedStringConfig],
    image: UIImage,
    size: CGSize = .init(width: 30, height: 30),
    contentMode: UIView.ContentMode = .scaleToFill
  );
  
  case multiLineRow(
    spacing: CGFloat = 8,
    label: [AttributedStringConfig],
    value: [AttributedStringConfig]
  );
  
  case customView(UIView);
  
  public func createView(colorThemeConfig: ColorThemeConfig) -> UIView {
    switch self {
      case let .singleRow(labelConfigRaw, valueConfigRaw):
        let rootHStack = {
          let stack = UIStackView();
          
          stack.axis = .horizontal;
          stack.distribution = .equalSpacing;
          stack.alignment = .fill;
                    
          return stack;
        }();
        
        var labelConfig = labelConfigRaw;
        labelConfig.append(.init(text: ":"));
        
        labelConfig = labelConfig.map {
          var configItem = $0;
          if configItem.foregroundColor == nil {
            configItem.foregroundColor = colorThemeConfig.colorTextDark;
          };
          
          if configItem.fontConfig.weight == nil {
            configItem.fontConfig.weight = .semibold;
          };
          
          return configItem;
        };
        
        let valueConfig = valueConfigRaw.map {
          var configItem = $0;
          if configItem.foregroundColor == nil {
            configItem.foregroundColor = colorThemeConfig.colorTextDark;
          };
          
          if configItem.fontConfig.weight == nil {
            configItem.fontConfig.weight = .regular;
          };
          
          return configItem;
        };
        
        let leftTitleLabel = UILabel();
        leftTitleLabel.attributedText = labelConfig.makeAttributedString();
        
        rootHStack.addArrangedSubview(leftTitleLabel);
        
        let rightValueLabel = UILabel();
        rightValueLabel.attributedText = valueConfig.makeAttributedString();
        
        rootHStack.addArrangedSubview(rightValueLabel);
        return rootHStack;
        
      case let.singeRowWithImageValue(labelConfigRaw, image, size, contentMode):
        let rootHStack = {
          let stack = UIStackView();
          
          stack.axis = .horizontal;
          stack.distribution = .equalSpacing;
          stack.alignment = .fill;
                    
          return stack;
        }();
        
        var labelConfig = labelConfigRaw;
        labelConfig.append(.init(text: ":"));
        
        labelConfig = labelConfig.map {
          var configItem = $0;
          if configItem.foregroundColor == nil {
            configItem.foregroundColor = colorThemeConfig.colorTextDark;
          };
          
          if configItem.fontConfig.weight == nil {
            configItem.fontConfig.weight = .semibold;
          };
          
          return configItem;
        };
        
        let leftTitleLabel = UILabel();
        leftTitleLabel.attributedText = labelConfig.makeAttributedString();
        
        rootHStack.addArrangedSubview(leftTitleLabel);
        
        let imageView = UIImageView(image: image);
        imageView.contentMode = contentMode;
        imageView.layer.cornerRadius = 6;
        imageView.clipsToBounds = true;
        
        NSLayoutConstraint.activate([
          imageView.heightAnchor.constraint(
            equalToConstant: size.height
          ),
          imageView.widthAnchor.constraint(
            equalToConstant: size.width
          ),
        ]);
        
        rootHStack.addArrangedSubview(imageView);
        return rootHStack;
        
      case let .multiLineRow(spacing, labelConfigRaw, valueConfigRaw):
        let rootVStack = {
          let stack = UIStackView();
          
          stack.axis = .vertical;
          //stack.distribution = .equalSpacing;
          stack.alignment = .leading;
          stack.spacing = spacing;
                    
          return stack;
        }();
        
        var labelConfig = labelConfigRaw;
        labelConfig.append(.init(text: ":"));
        
        labelConfig = labelConfig.map {
          var configItem = $0;
          if configItem.foregroundColor == nil {
            configItem.foregroundColor = colorThemeConfig.colorTextDark;
          };
          
          if configItem.fontConfig.weight == nil {
            configItem.fontConfig.weight = .semibold;
          };
          
          return configItem;
        };
        
        let valueConfig = valueConfigRaw.map {
          var configItem = $0;
          if configItem.foregroundColor == nil {
            configItem.foregroundColor = colorThemeConfig.colorTextDark;
          };
          
          if configItem.fontConfig.weight == nil {
            configItem.fontConfig.weight = .regular;
          };
          
          return configItem;
        };
        
        let topTitleLabel = UILabel();
        topTitleLabel.font = nil;
        topTitleLabel.textColor = nil;
        topTitleLabel.numberOfLines = 0
        topTitleLabel.lineBreakMode = .byWordWrapping;
        topTitleLabel.attributedText = labelConfig.makeAttributedString();
        
        rootVStack.addArrangedSubview(topTitleLabel);
        
        let bottomValueLabel = UILabel();
        bottomValueLabel.font = nil;
        bottomValueLabel.textColor = nil;
        bottomValueLabel.numberOfLines = 0
        bottomValueLabel.lineBreakMode = .byWordWrapping;
        bottomValueLabel.attributedText = valueConfig.makeAttributedString();
        
        rootVStack.addArrangedSubview(bottomValueLabel);
        return rootVStack;
        
      case let .customView(view):
        return view;
    };
  };
};
