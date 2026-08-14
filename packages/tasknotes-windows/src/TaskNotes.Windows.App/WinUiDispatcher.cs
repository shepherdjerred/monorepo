using Microsoft.UI.Dispatching;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App
{
    internal sealed class WinUiDispatcher(DispatcherQueue dispatcherQueue) : IUiDispatcher
    {
        private readonly DispatcherQueue _dispatcherQueue =
            dispatcherQueue ?? throw new ArgumentNullException(nameof(dispatcherQueue));

        public bool HasThreadAccess => _dispatcherQueue.HasThreadAccess;

        public void Enqueue(Action action)
        {
            ArgumentNullException.ThrowIfNull(action);
            if (HasThreadAccess)
            {
                action();
                return;
            }

            if (!_dispatcherQueue.TryEnqueue(() => action()))
            {
                throw new InvalidOperationException(
                    "The WinUI dispatcher rejected presentation work."
                );
            }
        }
    }
}
