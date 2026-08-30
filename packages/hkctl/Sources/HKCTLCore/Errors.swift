public import Foundation

public enum HKCTLError: Error, Equatable, LocalizedError, Sendable {
  case usage(String)
  case invalidBatch(String)
  case homeNotFound(String)
  case homeAmbiguous(String)
  case noPrimaryHome
  case targetNotFound(String)
  case targetAmbiguous(String)
  case destinationConflict(String)
  case operationFailed(String)
  case outputFailed(String)

  public var errorDescription: String? {
    switch self {
    case let .usage(message):
      message
    case let .invalidBatch(message):
      "Invalid batch request: \(message)"
    case let .homeNotFound(name):
      "No HomeKit home is named '\(name)'."
    case let .homeAmbiguous(name):
      "More than one HomeKit home is named '\(name)'; names must be unique for selection."
    case .noPrimaryHome:
      "HomeKit did not provide a primary home. Pass --home with an exact home name."
    case let .targetNotFound(message):
      message
    case let .targetAmbiguous(message):
      message
    case let .destinationConflict(message):
      message
    case let .operationFailed(message):
      message
    case let .outputFailed(message):
      message
    }
  }
}
