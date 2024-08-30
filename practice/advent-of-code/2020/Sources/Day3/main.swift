import Foundation

func arrayFromContentsOfFileWithName(fileName: String) -> [String]? {
    guard let url = Bundle.module.url(forResource: fileName, withExtension: "txt") else {
        return nil
    }

    do {
        let content = try String(contentsOf: url, encoding: String.Encoding.utf8)
        return content.components(separatedBy: "\n")
    } catch {
        return nil
    }
}

// Simplest way to throw an error/exception with a custom message in Swift 2?
// https://stackoverflow.com/a/40629365
extension String: Error {
}

func readMap() -> Map? {
    guard let mapStringArray = arrayFromContentsOfFileWithName(fileName: "input") else {
        return nil
    }

    do {
        let entities: [[Entity]] = try mapStringArray.map {
            try $0.map {
                guard let entity = charToEntity(character: $0) else {
                    throw "Unable to convert char to entity"
                }
                return entity
            }
        }

        return Map(entities: entities)
    } catch {
        return nil
    }
}

func charToEntity(character: Character) -> Entity? {
    switch character {
    case "#":
        return Entity.TREE
    case ".":
        return Entity.NONE
    default:
        return nil
    }
}

class Map {
    let entities: [[Entity]]
    let mapSize: MapSize

    init(entities: [[Entity]]) {
        self.entities = entities
        mapSize = MapSize(
                height: entities.count,
                width: entities[0].count
        )
    }

    func get(position: Position) -> Entity {
        let adjustedX = position.x % mapSize.width
        let adjustedY = position.y % mapSize.height
        return entities[adjustedY][adjustedX]
    }

    func isEntity(position: Position, entity: Entity) -> Bool {
        get(position: position) == entity
    }

    func isTree(position: Position) -> Bool {
        isEntity(position: position, entity: Entity.TREE)
    }

    func countCollision(position: Position) -> Int {
        isTree(position: position) ? 1 : 0
    }
}

struct MapSize {
    let height: Int
    let width: Int
}

struct MapTraversalStrategy {
    let down: Int
    let right: Int
}

struct Position {
    let x: Int
    let y: Int
}

func incrementPosition(position: Position, strategy: MapTraversalStrategy) -> Position {
    Position(x: position.x + strategy.right, y: position.y + strategy.down)
}

func countCollisions(map: Map, strategy: MapTraversalStrategy, position: Position) -> Int {
    if position.y > map.mapSize.height {
        return 0
    } else {
        print(position)
        return map.countCollision(position: position) + countCollisions(map: map, strategy: strategy, position: incrementPosition(position: position, strategy: strategy))
    }
}

enum Entity {
    case NONE
    case TREE
}

guard let map = readMap() else {
    print("Unable to read map")
    exit(1)
}

func check(map: Map, strategy: MapTraversalStrategy) -> Int {
    let origin = Position(x: 0, y: 0)
    return countCollisions(map: map, strategy: strategy, position: origin)
}

func checkMultiple(map: Map, strategies: [MapTraversalStrategy]) -> Int {
    strategies.map {
        check(map: map, strategy: $0)
    }.reduce(1, { left, right in
        left * right
    })
}

let strategies = [
    MapTraversalStrategy(down: 1, right: 1),
    MapTraversalStrategy(down: 1, right: 3),
    MapTraversalStrategy(down: 1, right: 5),
    MapTraversalStrategy(down: 1, right: 7),
    MapTraversalStrategy(down: 2, right: 1)
]
let product = checkMultiple(map: map, strategies: strategies)
print(product)
