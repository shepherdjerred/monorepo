import SwiftUI
import WidgetKit

@main
struct TasksWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayTasksWidget()
        if #available(iOS 18.0, *) {
            QuickAddTaskControl()
        }
    }
}
