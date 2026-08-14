using System.Runtime.InteropServices;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App
{
    internal sealed partial class GlobalHotkeyService : IGlobalHotkeyRegistrar
    {
        private const int HotkeyId = 0x544E;
        private const uint WmHotkey = 0x0312;
        private const int WindowProcedureIndex = -4;
        private readonly nint _windowHandle;
        private readonly WindowProcedure _windowProcedure;
        private readonly Action _invoked;
        private readonly nint _previousProcedure;
        private bool _registered;
        private bool _disposed;

        internal GlobalHotkeyService(nint windowHandle, Action invoked)
        {
            _windowHandle = windowHandle;
            _invoked = invoked;
            _windowProcedure = ProcessWindowMessage;
            nint procedure = Marshal.GetFunctionPointerForDelegate(_windowProcedure);
            _previousProcedure = NativeMethods.SetWindowLongPtr(
                windowHandle,
                WindowProcedureIndex,
                procedure
            );
            if (_previousProcedure == 0)
            {
                throw new InvalidOperationException(
                    $"Unable to listen for the Quick Add hotkey. Windows error {Marshal.GetLastPInvokeError()}."
                );
            }
        }

        public bool Register(string binding)
        {
            ThrowIfDisposed();
            Clear();
            HotkeyBinding hotkey = HotkeyBinding.Parse(binding);
            _registered = NativeMethods.RegisterHotKey(
                _windowHandle,
                HotkeyId,
                hotkey.Modifiers,
                hotkey.VirtualKey
            );
            return _registered;
        }

        public void Clear()
        {
            ThrowIfDisposed();
            if (_registered)
            {
                _ = NativeMethods.UnregisterHotKey(_windowHandle, HotkeyId);
                _registered = false;
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            Clear();
            _ = NativeMethods.SetWindowLongPtr(
                _windowHandle,
                WindowProcedureIndex,
                _previousProcedure
            );
            _disposed = true;
        }

        private nint ProcessWindowMessage(
            nint windowHandle,
            uint message,
            nuint wParam,
            nint lParam
        )
        {
            if (message == WmHotkey && wParam == HotkeyId)
            {
                _invoked();
                return 0;
            }
            return NativeMethods.CallWindowProc(
                _previousProcedure,
                windowHandle,
                message,
                wParam,
                lParam
            );
        }

        private void ThrowIfDisposed()
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
        }

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate nint WindowProcedure(
            nint windowHandle,
            uint message,
            nuint wParam,
            nint lParam
        );

        private static partial class NativeMethods
        {
            [LibraryImport("user32.dll", EntryPoint = "RegisterHotKey", SetLastError = true)]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static partial bool RegisterHotKey(
                nint windowHandle,
                int id,
                uint modifiers,
                uint virtualKey
            );

            [LibraryImport("user32.dll", EntryPoint = "UnregisterHotKey", SetLastError = true)]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static partial bool UnregisterHotKey(nint windowHandle, int id);

            [LibraryImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            internal static partial nint SetWindowLongPtr(
                nint windowHandle,
                int index,
                nint newValue
            );

            [LibraryImport("user32.dll", EntryPoint = "CallWindowProcW")]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            internal static partial nint CallWindowProc(
                nint previousProcedure,
                nint windowHandle,
                uint message,
                nuint wParam,
                nint lParam
            );
        }
    }
}
