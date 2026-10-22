public struct FacetTaskRowID: Hashable, Sendable {
    public let taskID: String
    public let occurrenceDate: String?
    public init(taskID: String, occurrenceDate: String?) {
        self.taskID = taskID
        self.occurrenceDate = occurrenceDate
    }
}

extension FacetTask {
    public var rowID: FacetTaskRowID { FacetTaskRowID(taskID: id, occurrenceDate: occurrenceDate) }
}
