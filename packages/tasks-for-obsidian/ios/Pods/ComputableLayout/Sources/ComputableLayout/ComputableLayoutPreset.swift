//
//  ComputableLayoutPreset.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 5/23/23.
//

import UIKit

public enum ComputableLayoutPreset: Equatable {

  case automatic;

  case offscreenBottom,
       offscreenTop,
       offscreenLeft,
       offscreenRight;
       
  case halfOffscreenBottom,
       halfOffscreenTop,
       halfOffscreenLeft,
       halfOffscreenRight;
      
  case edgeBottom,
       edgeTop,
       edgeLeft,
       edgeRight;
       
  case fitScreen,
       fitScreenHorizontally,
       fitScreenVertically;
       
  case center;
  
  case layoutConfig(_ config: ComputableLayout);
  
  // MARK: Functions
  // ---------------
  
  public func getLayoutConfig(
    fromBaseLayoutConfig baseLayoutConfig: ComputableLayout
  ) -> ComputableLayout {
  
    switch self {
      case .automatic:
        return baseLayoutConfig;
    
      case .offscreenBottom:
        return .init(
          derivedFrom: baseLayoutConfig,
          verticalAlignment: .bottom,
          marginTop: .constant(0),
          marginBottom: .percent(
            relativeTo: .currentHeight,
            percentValue: -1
          )
        );
      
      case .offscreenTop:
        return .init(
          derivedFrom: baseLayoutConfig,
          verticalAlignment: .top,
          marginTop: .percent(
            relativeTo: .currentHeight,
            percentValue: -1
          ),
          marginBottom: .constant(0)
        );
      
      case .offscreenLeft:
        return .init(
          derivedFrom: baseLayoutConfig,
          horizontalAlignment: .left,
          marginLeft: .percent(
            relativeTo: .currentWidth,
            percentValue: -1
          ),
          marginRight: .constant(0)
        );
      
      case .offscreenRight:
        return .init(
          derivedFrom: baseLayoutConfig,
          horizontalAlignment: .right,
          marginLeft: .constant(0),
          marginRight: .percent(
            relativeTo: .currentWidth,
            percentValue: -1
          )
        );
      
      case .edgeBottom:
        return .init(
          derivedFrom: baseLayoutConfig,
          verticalAlignment: .bottom
        );
        
      case .halfOffscreenBottom:
        return .init(
          derivedFrom: baseLayoutConfig,
          verticalAlignment: .top,
          marginTop: .constant(0),
          marginBottom: .percent(
            relativeTo: .currentHeight,
            percentValue: 0.5
          )
        );
      
      case .halfOffscreenTop:
        return .init(
          derivedFrom: baseLayoutConfig,
          verticalAlignment: .top,
          marginTop: .percent(
            relativeTo: .currentHeight,
            percentValue: -0.5
          ),
          marginBottom: .constant(0)
        );
        
      case .halfOffscreenLeft:
        return .init(
          derivedFrom: baseLayoutConfig,
          horizontalAlignment: .left,
          marginLeft: .percent(
            relativeTo: .currentWidth,
            percentValue: -0.5
          ),
          marginRight: .constant(0)
        );
        
      case .halfOffscreenRight:
        return .init(
          derivedFrom: baseLayoutConfig,
          horizontalAlignment: .right,
          marginLeft: .constant(0),
          marginRight: .percent(
            relativeTo: .currentWidth,
            percentValue: 0.5
          )
        );
      
      case .edgeTop:
        return .init(
          derivedFrom: baseLayoutConfig,
          verticalAlignment: .top,
          marginTop: .constant(0)
        );
      
      case .edgeLeft:
        return .init(
          derivedFrom: baseLayoutConfig,
          horizontalAlignment: .left,
          marginLeft: .constant(0)
        );
      
      case .edgeRight:
        return .init(
          derivedFrom: baseLayoutConfig,
          horizontalAlignment: .right,
          marginRight: .constant(0)
        );
      
      case .center:
        return .init(
          derivedFrom: baseLayoutConfig,
          verticalAlignment: .center
        );
        
      case .fitScreen:
        return .init(
          derivedFrom: baseLayoutConfig,
          horizontalAlignment: .center,
          verticalAlignment: .center,
          width: ComputableLayoutValue(
            mode: .stretch
          ),
          height: ComputableLayoutValue(
            mode: .stretch
          ),
          marginLeft: .constant(0),
          marginRight: .constant(0),
          marginTop: .constant(0),
          marginBottom: .constant(0)
        );
        
      case .fitScreenHorizontally:
        return .init(
          derivedFrom: baseLayoutConfig,
          width: ComputableLayoutValue(
            mode: .stretch
          ),
          marginLeft: .constant(0),
          marginRight: .constant(0)
        );
        
      case .fitScreenVertically:
        return .init(
          derivedFrom: baseLayoutConfig,
          height: ComputableLayoutValue(
            mode: .stretch
          ),
          marginTop: .constant(0)
        );
      
      case let .layoutConfig(config):
        return config;
    };
  };
};


