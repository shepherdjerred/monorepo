import TaskNotesKit

extension FacetStore {
    internal func resolvedDestination(_ target: FacetDestination) -> FacetDestination {
        switch target {
        case .project(let id): .project(id: localStore.resolvedID(id))
        case .label(let id): .label(id: localStore.resolvedID(id))
        case .filter(let id): .filter(id: localStore.resolvedID(id))
        case .section, .board: target
        }
    }
}
