import Foundation

@MainActor
public protocol HomeGateway: AnyObject {
  func homes() async throws -> [HomeSnapshot]
  func renameRoom(homeID: String, roomID: String, to name: String) async throws
  func removeRoom(homeID: String, roomID: String) async throws
  func renameAccessory(homeID: String, accessoryID: String, to name: String) async throws
  func assignAccessory(homeID: String, accessoryID: String, roomID: String) async throws
  func removeAccessory(homeID: String, accessoryID: String) async throws
}

public enum ExecutionOutcome: Equatable, Sendable {
  case success(ExecutionReport)
  case failure(ExecutionReport)
}

@MainActor
public struct CommandExecutor {
  public init() {}

  public func execute(
    invocation: Invocation,
    operations: [Operation],
    gateway: any HomeGateway
  ) async throws -> ExecutionOutcome {
    let homes = try await gateway.homes()
    let home = try selectHome(named: invocation.homeName, from: homes)
    if operations.isEmpty {
      return .success(
        ExecutionReport(success: true, mode: .readOnly, home: home, results: [])
      )
    }

    let planned = try Planner.plan(home: home, operations: operations)
    if !invocation.applyChanges {
      let results = planned.map { plannedOperation in
        OperationResult(
          operation: plannedOperation.operation,
          status: plannedOperation.isUnchanged ? .unchanged : .planned,
          summary: plannedOperation.summary
        )
      }
      return .success(
        ExecutionReport(success: true, mode: .dryRun, home: home, results: results)
      )
    }

    return await apply(planned: planned, originalHome: home, gateway: gateway)
  }

  public func selectHome(named name: String?, from homes: [HomeSnapshot]) throws -> HomeSnapshot {
    if let name {
      let matches = homes.filter { $0.name == name }
      guard !matches.isEmpty else { throw HKCTLError.homeNotFound(name) }
      guard matches.count == 1, let home = matches.first else {
        throw HKCTLError.homeAmbiguous(name)
      }
      return home
    }

    let primaryHomes = homes.filter(\.isPrimary)
    guard primaryHomes.count == 1, let home = primaryHomes.first else {
      throw HKCTLError.noPrimaryHome
    }
    return home
  }

  private func apply(
    planned: [PlannedOperation],
    originalHome: HomeSnapshot,
    gateway: any HomeGateway
  ) async -> ExecutionOutcome {
    var results: [OperationResult] = []
    for (index, operation) in planned.enumerated() {
      if operation.isUnchanged {
        results.append(
          OperationResult(
            operation: operation.operation,
            status: .unchanged,
            summary: operation.summary
          )
        )
        continue
      }

      do {
        try await apply(operation: operation, gateway: gateway)
        results.append(
          OperationResult(
            operation: operation.operation,
            status: .applied,
            summary: operation.summary
          )
        )
      } catch {
        results.append(
          OperationResult(
            operation: operation.operation,
            status: .failed,
            summary: "\(operation.summary) HomeKit returned: \(error.localizedDescription)"
          )
        )
        for pending in planned.dropFirst(index + 1) {
          results.append(
            OperationResult(
              operation: pending.operation,
              status: .notRun,
              summary: pending.summary
            )
          )
        }
        return await failureAfterMutation(
          originalHome: originalHome,
          results: results,
          gateway: gateway
        )
      }
    }

    return await outcomeAfterCompletedMutations(
      originalHome: originalHome,
      results: results,
      gateway: gateway
    )
  }

  private func failureAfterMutation(
    originalHome: HomeSnapshot,
    results: [OperationResult],
    gateway: any HomeGateway
  ) async -> ExecutionOutcome {
    let refreshed: (home: HomeSnapshot, error: String?)
    do {
      refreshed = (try await refreshedHome(id: originalHome.id, gateway: gateway), nil)
    } catch {
      refreshed = (
        originalHome,
        " HomeKit state could not be refreshed after the failure: \(error.localizedDescription)"
      )
    }
    return .failure(
      ExecutionReport(
        success: false,
        mode: .applied,
        home: refreshed.home,
        results: results,
        error: "HomeKit stopped after the first failed mutation.\(refreshed.error ?? "")"
      )
    )
  }

  private func outcomeAfterCompletedMutations(
    originalHome: HomeSnapshot,
    results: [OperationResult],
    gateway: any HomeGateway
  ) async -> ExecutionOutcome {
    do {
      let home = try await refreshedHome(id: originalHome.id, gateway: gateway)
      return .success(ExecutionReport(success: true, mode: .applied, home: home, results: results))
    } catch {
      return .failure(
        ExecutionReport(
          success: false,
          mode: .applied,
          home: originalHome,
          results: results,
          error:
            "Mutations were applied, but refreshing HomeKit state failed: \(error.localizedDescription)"
        )
      )
    }
  }

  private func apply(operation: PlannedOperation, gateway: any HomeGateway) async throws {
    switch operation {
    case let .renameRoom(homeID, roomID, operation, _):
      guard case let .renameRoom(_, to) = operation else {
        throw HKCTLError.operationFailed("Internal rename-room plan mismatch.")
      }
      try await gateway.renameRoom(homeID: homeID, roomID: roomID, to: to)
    case let .removeRoom(homeID, roomID, _, _):
      try await gateway.removeRoom(homeID: homeID, roomID: roomID)
    case let .renameAccessory(homeID, accessoryID, operation, _):
      guard case let .renameAccessory(_, to) = operation else {
        throw HKCTLError.operationFailed("Internal rename-accessory plan mismatch.")
      }
      try await gateway.renameAccessory(homeID: homeID, accessoryID: accessoryID, to: to)
    case let .assignAccessory(homeID, accessoryID, roomID, _, _):
      try await gateway.assignAccessory(
        homeID: homeID,
        accessoryID: accessoryID,
        roomID: roomID
      )
    case let .removeAccessory(homeID, accessoryID, _, _):
      try await gateway.removeAccessory(homeID: homeID, accessoryID: accessoryID)
    case .unchanged:
      break
    }
  }

  private func refreshedHome(
    id: String,
    gateway: any HomeGateway
  ) async throws -> HomeSnapshot {
    let homes = try await gateway.homes()
    guard let home = homes.first(where: { $0.id == id }) else {
      throw HKCTLError.operationFailed(
        "HomeKit no longer contains the selected home after applying mutations."
      )
    }
    return home
  }
}
