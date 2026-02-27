//
//  ImageConfigParser.swift
//  
//
//  Created by Dominic Go on 8/7/24.
//

import UIKit


public final class ImageConfigLoader {

  public typealias `Self` = ImageConfigLoader;
  
  public static var imageLoadMaxAttemptsDefault: Int = 3;
  
  public var eventDelegates:
    MulticastDelegate<ImageConfigLoaderEventsNotifiable> = .init();
  
  public var imageConfig: ImageConfig;
  
  public var dispatchQosDefault: DispatchQoS.QoSClass = .background;
  
  private(set) public var imageLoadAttemptCount = 0;
  public var imageLoadMaxAttemptsOverride: Int?;
  
  public init(imageConfig: ImageConfig) {
    self.imageConfig = imageConfig;
  };
};


// MARK: - ImageConfigLoader+ComputedProperties
// --------------------------------------------

public extension ImageConfigLoader {
  
  var imageType: String {
    type(of: self.imageConfig).imageType;
  };
  
  var isImageLoading: Bool {
    self.imageConfig.isImageLoaded;
  };
  
  var cachedImage: UIImage? {
    self.imageConfig.cachedImage;
  };
  
  var imageLoadMaxAttempts: Int {
       self.imageLoadMaxAttemptsOverride
    ?? Self.imageLoadMaxAttemptsDefault;
  };
  
  var hasRemainingAttemptsToLoadImage: Bool {
    self.imageLoadAttemptCount < self.imageLoadMaxAttempts;
  };
};

// MARK: - ImageConfigLoader+PublicMethods
// ---------------------------------------

public extension ImageConfigLoader {
  typealias CompletionHandler = (_ sender: Self) -> Void;

  func resetImageLoadAttemptCount(){
    self.imageLoadAttemptCount = 0;
  };
  
  func loadImageIfNeeded(
    dispatchQos dispatchQosOverride: DispatchQoS.QoSClass? = nil,
    shouldAlwaysInvokeCompletion: Bool = false,
    completion: CompletionHandler? = nil
    // useSharedQueue: Bool = false
  ) {
  
    func invokeCompletionIfNeeded(didLoad: Bool = false){
      guard let completion = completion,
            shouldAlwaysInvokeCompletion || didLoad
      else {
        return;
      };
      
      completion(self);
    };
    
    guard !self.imageConfig.isImageLoaded,
          self.hasRemainingAttemptsToLoadImage
    else {
      invokeCompletionIfNeeded();
      return;
    };
    
    self.imageConfig.isImageLoading = true;
    self.imageLoadAttemptCount += 1;
    
    self.eventDelegates.invoke {
      $0.notifyOnImageWillLoad(sender: self);
    };
    
    let dispatchQoS = dispatchQosOverride ?? self.dispatchQosDefault;
    
    DispatchQueue.global(qos: dispatchQoS).async {
      var imageConfigCopy = self.imageConfig;
      
      let image = try? imageConfigCopy.makeImage();
      imageConfigCopy.cachedImage = image;
      imageConfigCopy.isImageLoading = false;
      
      DispatchQueue.main.async {
        let imageTypeOld = type(of: self.imageConfig).imageType;
        let imageTypeNew = type(of: imageConfigCopy).imageType;
      
        guard imageTypeNew == imageTypeOld else {
          invokeCompletionIfNeeded();
          return;
        };
        
        self.imageConfig = imageConfigCopy;
        
        completion?(self);
        self.eventDelegates.invoke {
          $0.notifyOnImageDidLoad(sender: self);
        };
      }
    };
  };
};
