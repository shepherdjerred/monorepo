public import Observation
import ServiceManagement

public enum LoginItemStatus: Equatable, Sendable {
  case disabled
  case enabled
  case requiresApproval
  case unavailable
}

@MainActor
public protocol LoginItemService: AnyObject {
  var status: LoginItemStatus { get }
  func register() throws
  func unregister() throws
}

@MainActor
public final class SystemLoginItemService: LoginItemService {
  public init() {}

  public var status: LoginItemStatus {
    switch SMAppService.mainApp.status {
    case .notRegistered: .disabled
    case .enabled: .enabled
    case .requiresApproval: .requiresApproval
    case .notFound: .unavailable
    @unknown default: .unavailable
    }
  }

  public func register() throws {
    try SMAppService.mainApp.register()
  }

  public func unregister() throws {
    try SMAppService.mainApp.unregister()
  }
}

@MainActor @Observable
public final class LaunchAtLoginController {
  public private(set) var status: LoginItemStatus
  public private(set) var errorMessage: String?

  private let service: any LoginItemService

  public init(service: any LoginItemService = SystemLoginItemService()) {
    self.service = service
    self.status = service.status
  }

  public var isEnabled: Bool { status == .enabled }

  public func refresh() {
    status = service.status
  }

  public func setEnabled(_ enabled: Bool) {
    errorMessage = nil
    do {
      if enabled {
        try service.register()
      } else {
        try service.unregister()
      }
      status = service.status
    } catch {
      status = service.status
      errorMessage = "Launch at login could not be updated."
    }
  }
}
