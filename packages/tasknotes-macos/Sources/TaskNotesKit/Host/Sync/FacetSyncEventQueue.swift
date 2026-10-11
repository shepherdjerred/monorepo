internal actor FacetSyncEventQueue<Element: Sendable> {
    private var buffered: [Element] = []
    private var producers: [(Element, CheckedContinuation<Bool, Never>)] = []
    private var consumer: CheckedContinuation<Element?, Never>?
    private var closed = false
    private let capacity: Int
    private var revision: UInt64 = 0
    init(capacity: Int) { self.capacity = capacity }

    func pendingCount() -> Int { buffered.count + producers.count }
    func observation() -> (count: Int, revision: UInt64) {
        (buffered.count + producers.count, revision)
    }

    func send(_ value: Element) async -> Bool {
        guard !closed else { return false }
        revision += 1
        if let waiting = consumer {
            consumer = nil
            waiting.resume(returning: value)
            return true
        }
        if buffered.count < capacity {
            buffered.append(value)
            return true
        }
        return await withCheckedContinuation { producers.append((value, $0)) }
    }

    func next() async -> Element? {
        if !buffered.isEmpty {
            revision += 1
            let value = buffered.removeFirst()
            if !producers.isEmpty {
                let producer = producers.removeFirst()
                buffered.append(producer.0)
                producer.1.resume(returning: true)
            }
            return value
        }
        if closed { return nil }
        return await withCheckedContinuation { consumer = $0 }
    }

    func close() {
        closed = true
        revision += 1
        buffered.removeAll()
        consumer?.resume(returning: nil)
        consumer = nil
        for producer in producers { producer.1.resume(returning: false) }
        producers.removeAll()
    }
}
