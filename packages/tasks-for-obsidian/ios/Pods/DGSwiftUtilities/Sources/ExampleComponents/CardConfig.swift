//
//  CardConfig.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/9/24.
//

import UIKit

public struct CardConfig {

  // MARK: - Properties
  // ------------------

  public var title: String;
  public var subtitle: String?;
  public var desc: [AttributedStringConfig];
  public var index: Int?;
  public var colorThemeConfig: ColorThemeConfig;
  
  public var content: [CardContentItem];
  
  public weak var cardViewController: CardViewController?;
  
  // MARK: - Init
  // ------------
  
  public init(
    title: String,
    subtitle: String? = nil,
    desc: [AttributedStringConfig],
    index: Int? = nil,
    colorThemeConfig: ColorThemeConfig = .presetPurple,
    content: [CardContentItem]
  ) {
    self.title = title;
    self.subtitle = subtitle;
    self.desc = desc;
    self.index = index;
    self.colorThemeConfig = colorThemeConfig;
    self.content = content;
  }
  
  // MARK: - Functions
  // -----------------
  
  func _createCardHeader() -> UIStackView {
    let isTitleOnly = self.subtitle == nil;
  
    let rootVStack = {
      let stack = UIStackView();
      
      stack.axis = .vertical;
      stack.distribution = .fill;
      stack.alignment = .fill;
      stack.spacing = 8;
      
      stack.backgroundColor = self.colorThemeConfig.colorBgDark;
      
      stack.isLayoutMarginsRelativeArrangement = true;
      stack.layoutMargins = UIEdgeInsets(
        top: isTitleOnly ? 8 : 6,
        left: 10,
        bottom: 8,
        right: 10
      );
      
      return stack;
    }();
    
    let topRootView = UIView();
    rootVStack.addArrangedSubview(topRootView);
    
    let leftNumberIndicator: UIView? = {
      guard let index = self.index else {
        return nil;
      };
      
      let label = UILabel();
      label.text = "\(index)";
      label.textColor = .white;
      
      label.font = UIFont.systemFont(ofSize: 16, weight: .heavy);
      label.textColor = .init(white: 1, alpha: 0.75);
      
      return label;
    }();
    
    if let leftNumberIndicator = leftNumberIndicator {
      topRootView.addSubview(leftNumberIndicator);
      leftNumberIndicator.translatesAutoresizingMaskIntoConstraints = false;
      leftNumberIndicator.setContentHuggingPriority(.defaultHigh, for: .horizontal);
      
      NSLayoutConstraint.activate([
        leftNumberIndicator.topAnchor.constraint(
          equalTo: topRootView.topAnchor
        ),
        leftNumberIndicator.bottomAnchor.constraint(
          equalTo: topRootView.bottomAnchor
        ),
        leftNumberIndicator.leadingAnchor.constraint(
          equalTo: topRootView.leadingAnchor
        ),
      ]);
    };
    
    let rightStackView = {
      let stack = UIStackView();
      
      stack.axis = .vertical;
      stack.distribution = .fill;
      stack.alignment = .fill;
      
      return stack;
    }();
    
    rightStackView.addArrangedSubview({
      let label = UILabel();
      label.text = self.title;
      
      label.font = UIFont.systemFont(ofSize: 14, weight: .bold);
      label.textColor = .init(white: 1, alpha: 0.95);
      
      return label;
    }());
    
    if let subtitle = self.subtitle {
      let subtitleLabel = UILabel();
      subtitleLabel.text = subtitle;
      
      subtitleLabel.font = UIFont.systemFont(ofSize: 13, weight: .regular);
      subtitleLabel.textColor = .init(white: 1, alpha: 0.75);
      
      rightStackView.addArrangedSubview(subtitleLabel);
    };
    
    topRootView.addSubview(rightStackView);
    rightStackView.translatesAutoresizingMaskIntoConstraints = false;
    
    NSLayoutConstraint.activate({
      var constraint: [NSLayoutConstraint] = [
        rightStackView.topAnchor.constraint(
          equalTo: topRootView.topAnchor
        ),
        rightStackView.bottomAnchor.constraint(
          equalTo: topRootView.bottomAnchor
        ),
        rightStackView.trailingAnchor.constraint(
          equalTo: topRootView.trailingAnchor
        ),
      ];
      
      if let leftNumberIndicator = leftNumberIndicator {
        constraint += [
          leftNumberIndicator.trailingAnchor.constraint(
            equalTo: rightStackView.leadingAnchor,
            constant: -8
          ),
        ];
        
      } else {
        constraint += [
          rightStackView.leadingAnchor.constraint(
            equalTo: topRootView.leadingAnchor,
            constant: 4
          ),
        ];
      };
      
      return constraint;
    }());
    
    return rootVStack;
  };
    
  func _createCardBody() -> UIStackView {
    let descLabel: UILabel? = {
      guard self.desc.count > 0 else { return nil };
    
      var configs: [AttributedStringConfig] = [
        .init(
          text: "Description: ",
          weight: .bold,
          color: self.colorThemeConfig.colorBgDark
        ),
      ];
      
      configs += self.desc;
      
      for index in 0..<configs.count {
        if configs[index].foregroundColor == nil {
          configs[index].foregroundColor = self.colorThemeConfig.colorTextDark;
        };
      };
      
      let label = UILabel();
      label.font = nil;
      label.textColor = nil;
      label.numberOfLines = 0
      label.lineBreakMode = .byWordWrapping;
      label.attributedText = configs.makeAttributedString();
      
      return label;
    }();
    
    let bodyVStack = {
      let stack = UIStackView();
      
      stack.axis = .vertical;
      stack.distribution = .fill;
      stack.alignment = .fill;
      stack.spacing = 12;
      
      let hasDesc = descLabel != nil;
      let hasContent = self.content.count > 0;
      
      stack.isLayoutMarginsRelativeArrangement = true;
      stack.layoutMargins = UIEdgeInsets(
        top: hasDesc ? 8 : 16,
        left: 10,
        bottom: hasContent ? 12 : 8,
        right: 10
      );
                
      return stack;
    }();
    
    if let descLabel = descLabel {
      bodyVStack.addArrangedSubview(descLabel);
    };
    
    let contentViews = self.content.map {
      $0.makeContent(
        cardConfig: self,
        themeColorConfig: self.colorThemeConfig
      );
    };
    
    contentViews.forEach {
      bodyVStack.addArrangedSubview($0);
    };
    
    return bodyVStack;
  };
  
  public func createCardView() -> (
    rootVStack: UIStackView,
    headingVStack: UIStackView,
    bodyVStack: UIStackView
  ) {
    let rootVStack = {
      let stack = UIStackView();
      
      stack.axis = .vertical;
      stack.distribution = .fill;
      stack.alignment = .fill;
      
      stack.layer.cornerRadius = 8;
      stack.layer.maskedCorners = .allCorners;
      
      stack.clipsToBounds = true;
                
      return stack;
    }();
    
    rootVStack.backgroundColor = self.colorThemeConfig.colorBgLight;
    
    let headingVStack = self._createCardHeader();
    rootVStack.addArrangedSubview(headingVStack);
    
    let bodyVStack = self._createCardBody();
    rootVStack.addArrangedSubview(bodyVStack);

    return (rootVStack, headingVStack, bodyVStack);
  };
};

