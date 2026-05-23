import Foundation

// MARK: - K8sNodeList

package struct K8sNodeList: Codable {
    let items: [K8sNode]
}

// MARK: - K8sNode

package struct K8sNode: Codable {
    struct K8sNodeMetadata: Codable {
        let name: String
        let labels: [String: String]
    }

    struct K8sNodeStatus: Codable {
        struct NodeInfo: Codable {
            let kubeletVersion: String
        }

        let conditions: [K8sCondition]
        let nodeInfo: NodeInfo
    }

    let metadata: K8sNodeMetadata
    let status: K8sNodeStatus
}

// MARK: - K8sCondition

package struct K8sCondition: Codable {
    let type: String
    let status: String
}

// MARK: - K8sPodList

package struct K8sPodList: Codable {
    let items: [K8sPod]
}

// MARK: - K8sPod

package struct K8sPod: Codable {
    struct K8sPodMetadata: Codable {
        let name: String
        let namespace: String
    }

    struct K8sPodStatus: Codable {
        struct ContainerStatus: Codable {
            let ready: Bool
            let restartCount: Int
        }

        let phase: String?
        let containerStatuses: [ContainerStatus]?
    }

    let metadata: K8sPodMetadata
    let status: K8sPodStatus
}

// MARK: - K8sEventList

package struct K8sEventList: Codable {
    let items: [K8sEvent]
}

// MARK: - K8sEvent

package struct K8sEvent: Codable {
    struct InvolvedObject: Codable {
        let kind: String
        let name: String
        let namespace: String?
    }

    let reason: String?
    let message: String?
    let involvedObject: InvolvedObject
    let type: String?
    let count: Int?
    let lastTimestamp: String?
}

// MARK: - K8sDaemonSetList

package struct K8sDaemonSetList: Codable {
    let items: [K8sDaemonSetItem]
}

// MARK: - K8sDaemonSetItem

package struct K8sDaemonSetItem: Codable {
    struct Metadata: Codable {
        let name: String
        let namespace: String
    }

    struct Status: Codable {
        let desiredNumberScheduled: Int
        let numberReady: Int
    }

    let metadata: Metadata
    let status: Status
}

// MARK: - K8sStatefulSetList

package struct K8sStatefulSetList: Codable {
    let items: [K8sStatefulSetItem]
}

// MARK: - K8sStatefulSetItem

package struct K8sStatefulSetItem: Codable {
    struct Metadata: Codable {
        let name: String
        let namespace: String
    }

    struct Status: Codable {
        let replicas: Int?
        let readyReplicas: Int?
    }

    let metadata: Metadata
    let status: Status
}

// MARK: - K8sPVCList

package struct K8sPVCList: Codable {
    let items: [K8sPVCItem]
}

// MARK: - K8sPVCItem

package struct K8sPVCItem: Codable {
    struct Metadata: Codable {
        let name: String
        let namespace: String
    }

    struct Spec: Codable {
        let storageClassName: String?
    }

    struct Status: Codable {
        let phase: String?
        let capacity: [String: String]?
    }

    let metadata: Metadata
    let spec: Spec
    let status: Status?
}

// MARK: - K8sMetricsNodeList

package struct K8sMetricsNodeList: Codable {
    let items: [K8sMetricsNode]
}

// MARK: - K8sMetricsNode

package struct K8sMetricsNode: Codable {
    let metadata: K8sMetricsNodeMetadata
    let usage: K8sResourceUsage
}

// MARK: - K8sMetricsNodeMetadata

package struct K8sMetricsNodeMetadata: Codable {
    let name: String
}

// MARK: - K8sResourceUsage

package struct K8sResourceUsage: Codable {
    let cpu: String
    let memory: String
}
