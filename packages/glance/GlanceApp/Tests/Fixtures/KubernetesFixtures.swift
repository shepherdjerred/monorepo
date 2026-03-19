import Foundation

enum KubernetesFixtures {
    static let healthyNodesJSON = Data("""
    {
        "items": [
            {
                "metadata": {
                    "name": "node-1",
                    "labels": {
                        "node-role.kubernetes.io/control-plane": ""
                    }
                },
                "status": {
                    "conditions": [
                        {"type": "Ready", "status": "True"},
                        {"type": "MemoryPressure", "status": "False"}
                    ],
                    "nodeInfo": {"kubeletVersion": "v1.31.0"}
                }
            },
            {
                "metadata": {
                    "name": "node-2",
                    "labels": {
                        "node-role.kubernetes.io/worker": ""
                    }
                },
                "status": {
                    "conditions": [
                        {"type": "Ready", "status": "True"}
                    ],
                    "nodeInfo": {"kubeletVersion": "v1.31.0"}
                }
            },
            {
                "metadata": {
                    "name": "node-3",
                    "labels": {
                        "node-role.kubernetes.io/worker": ""
                    }
                },
                "status": {
                    "conditions": [
                        {"type": "Ready", "status": "True"}
                    ],
                    "nodeInfo": {"kubeletVersion": "v1.31.0"}
                }
            }
        ]
    }
    """.utf8)

    static let nodeNotReadyJSON = Data("""
    {
        "items": [
            {
                "metadata": {
                    "name": "node-1",
                    "labels": {
                        "node-role.kubernetes.io/control-plane": ""
                    }
                },
                "status": {
                    "conditions": [
                        {"type": "Ready", "status": "True"}
                    ],
                    "nodeInfo": {"kubeletVersion": "v1.31.0"}
                }
            },
            {
                "metadata": {
                    "name": "node-2",
                    "labels": {
                        "node-role.kubernetes.io/worker": ""
                    }
                },
                "status": {
                    "conditions": [
                        {"type": "Ready", "status": "False"}
                    ],
                    "nodeInfo": {"kubeletVersion": "v1.31.0"}
                }
            }
        ]
    }
    """.utf8)

    static let emptyNodesJSON = Data("""
    {"items": []}
    """.utf8)

    static let emptyPodsJSON = Data("""
    {"items": []}
    """.utf8)

    static let unhealthyPodsJSON = Data("""
    {
        "items": [
            {
                "metadata": {"name": "crash-pod", "namespace": "default"},
                "status": {
                    "phase": "CrashLoopBackOff",
                    "containerStatuses": [
                        {"ready": false, "restartCount": 15}
                    ]
                }
            },
            {
                "metadata": {"name": "pending-pod", "namespace": "kube-system"},
                "status": {
                    "phase": "Pending",
                    "containerStatuses": [
                        {"ready": false, "restartCount": 0}
                    ]
                }
            }
        ]
    }
    """.utf8)

    static let podWithMultipleContainersJSON = Data("""
    {
        "items": [
            {
                "metadata": {"name": "multi-container", "namespace": "default"},
                "status": {
                    "phase": "Running",
                    "containerStatuses": [
                        {"ready": true, "restartCount": 2},
                        {"ready": false, "restartCount": 5}
                    ]
                }
            }
        ]
    }
    """.utf8)

    static let podWithNoContainerStatusJSON = Data("""
    {
        "items": [
            {
                "metadata": {"name": "init-pod", "namespace": "default"},
                "status": {
                    "phase": "Pending"
                }
            }
        ]
    }
    """.utf8)
}
