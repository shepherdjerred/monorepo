//
//  AuxiliaryPreviewError.swift
//  
//
//  Created by Dominic Go on 11/16/23.
//

import DGSwiftUtilities

public struct AuxiliaryPreviewErrorMetadata: ErrorMetadata {
  public static var domain: String? = "ContextMenuAuxiliaryPreview";
  public static var parentType: String? = nil;
};

public typealias AuxiliaryPreviewError =
  VerboseError<AuxiliaryPreviewErrorMetadata, GenericErrorCode>;
