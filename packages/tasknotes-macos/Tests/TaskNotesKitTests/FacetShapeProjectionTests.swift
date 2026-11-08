import Testing

@testable import TaskNotesKit

struct FacetShapeProjectionTests {
    @Test func wrongShapesRemainDistinctFromEmptyValues() {
        let scalar = FacetValue.string("vendor")
        #expect(scalar.object == nil)
        #expect(scalar.array == nil)
        let emptyObject = FacetValue.object([:])
        #expect(emptyObject.object?.fields.isEmpty == true)
        #expect(emptyObject.array == nil)
        let number = FacetValue.rawNumber("9007199254740993.000000000000000001")
        let array = FacetValue.array([number])
        #expect(array.array?.elements == [number])
        #expect(array.object == nil)
    }
}
