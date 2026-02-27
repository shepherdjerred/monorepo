//
//  ClassRegistry.swift
//  ReactNativeIosUtilities
//
//  Created by Dominic Go on 2/15/24.
//

import Foundation
import ObjectiveC.runtime


/// Should only be used for debugging...
/// 
public final class ClassRegistry {

  public enum ClassListRetrievalMode: String {
    
    /// Use: `objc_getClassList`
    case classList;
    
    /// Use: `objc_copyClassList`
    case copyClassList;
    
    case custom;
  };

  public typealias CompletionHandler = (
    _ sender: ClassRegistry,
    _ allClasses: [AnyClass]
  ) -> Void;
  
  public static var shared: ClassRegistry = .init();
  
  // MARK: - Private Properties
  // --------------------------
  
  private var _completionBlockQueue: [CompletionHandler] = [];
  
  #if DEBUG
  public var _debugTimesLoaded: Int = 0;
  #endif
  
  // MARK: - Public Properties
  // -------------------------
  
  public var classListRetrievalMode: ClassListRetrievalMode = .classList;
  
  public var allClassesCached: [AnyClass]?;
  
  public var loadingState: LoadingState = .notLoaded;
  
  var customClassListGetter: Optional<() -> [AnyClass]> = nil;
  
  // MARK: -
  // -------
  
  private init(){
    // no-op
  };
  
  private func _notifyForCompletion(allClasses: [AnyClass]) {
    for completionBlock in self._completionBlockQueue {
      completionBlock(self, allClasses);
    };
    
    self._completionBlockQueue = [];
  };
  
  public func loadClasses(
    preferredQos: DispatchQoS.QoSClass = .background,
    completion completionBlock: CompletionHandler?
  ){
    if let completionBlock = completionBlock {
      self._completionBlockQueue.append(completionBlock);
    };
  
    if let allClasses = self.allClassesCached,
       self.loadingState.isLoaded
    {
      self._notifyForCompletion(allClasses: allClasses);
      return;
    };
    
    guard self.loadingState.shouldLoad else { return };
    self.allClassesCached = nil;
    self.loadingState = .loading;
    
    DispatchQueue.global(qos: preferredQos).async {
      let classes: [AnyClass];
    
      switch self.classListRetrievalMode {
        case .custom:
          guard let customClassListGetter = self.customClassListGetter else {
            fallthrough;
          };
          classes = customClassListGetter();
          
        case .classList:
          classes = Self.getAllClassesSync();
          
        case .copyClassList:
          classes = Self.getCopyOfClassesSync();
      };
    
      DispatchQueue.main.async {
        self.allClassesCached = classes;
        self.loadingState = .loaded;
        
        #if DEBUG
        self._debugTimesLoaded += 1;
        #endif
        
        self._notifyForCompletion(allClasses: classes);
      }
    };
  };
  
  public func clearCache(){
    self.allClassesCached = nil;
    self.loadingState = .notLoaded;
  };
  
  public func reloadClasses(completion completionBlock: CompletionHandler?){
    self.clearCache();
    self.loadClasses(completion: completionBlock);
  };
};

// MARK: - ClassRegistry+StaticMethods
// -----------------------------------

public extension ClassRegistry {

  static func getAllClassesSync() -> [AnyClass] {
  
    let numberOfClassesRaw = objc_getClassList(
      /* buffer:       */ nil,
      /* buffer count: */ 0
    );

    guard numberOfClassesRaw > 0 else {
      return [];
    };
    
    let numberOfClasses = Int(numberOfClassesRaw);

    let classesPtr =
      UnsafeMutablePointer<AnyClass>.allocate(capacity: numberOfClasses);
      
    let autoreleasingClasses =
      AutoreleasingUnsafeMutablePointer<AnyClass>(classesPtr);

    let count = objc_getClassList(autoreleasingClasses, Int32(numberOfClasses));
    assert(count > 0);

    defer {
      classesPtr.deallocate();
    };

    var classes: [AnyClass] = [];

    for index in 0 ..< numberOfClasses {
      classes.append(classesPtr[index]);
    };

    return classes;
  };
  
  static func getCopyOfClassesSync() -> [AnyClass] {
    var classListCountRaw = UInt32(0);
    
    guard let classListPointer = objc_copyClassList(&classListCountRaw) else {
      return [];
    };
    
    defer {
      free(UnsafeMutableRawPointer(classListPointer));
    };
    
    let classListCount = Int(classListCountRaw);
    let classListBuffer = UnsafeBufferPointer(
      start: classListPointer,
      count: classListCount
    );
    
    var classList: [AnyClass] = [];
    for classObject in classListBuffer {
      classList.append(classObject);
    };
    
    return classList;
  };
};
