using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using Microsoft.UI.Dispatching;
using Microsoft.VisualStudio.Threading;
using Windows.ApplicationModel.Background;

namespace TaskNotes.Windows.App;

/// <summary>Dispatches packaged COM background activation before the WinUI application is constructed.</summary>
internal static partial class Program
{
    private static readonly ManualResetEventSlim BackgroundCompleted = new();
    private static readonly ManualResetEventSlim BackgroundStarted = new();
    private static readonly Guid UnknownId = new("00000000-0000-0000-C000-000000000046");

    [STAThread]
    private static void Main(string[] args)
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        if (args.Contains("-FacetBackgroundServer", StringComparer.Ordinal))
        {
            using JoinableTaskContext context = new();
            context.Factory.Run(() =>
                Task.Factory.StartNew(
                    RunBackgroundServer,
                    CancellationToken.None,
                    TaskCreationOptions.LongRunning,
                    TaskScheduler.Default
                )
            );
            return;
        }
        Microsoft.UI.Xaml.Application.Start(parameters =>
        {
            _ = parameters;
            var context = new DispatcherQueueSynchronizationContext(
                DispatcherQueue.GetForCurrentThread()
            );
            SynchronizationContext.SetSynchronizationContext(context);
            _ = new App();
        });
    }

    private static void RunBackgroundServer()
    {
        Marshal.ThrowExceptionForHR(InitializeCom(0, 0));
        try
        {
            Guid id = typeof(FacetBackgroundTask).GUID;
            var factory = new TaskFactory();
            Marshal.ThrowExceptionForHR(Register(ref id, factory, 4, 1, out uint token));
            try
            {
                if (BackgroundStarted.Wait(TimeSpan.FromSeconds(90)))
                    BackgroundCompleted.Wait();
            }
            finally
            {
                Marshal.ThrowExceptionForHR(Revoke(token));
            }
        }
        finally
        {
            UninitializeCom();
        }
    }

    internal static void CompleteBackgroundActivation() => BackgroundCompleted.Set();

    internal static void BeginBackgroundActivation() => BackgroundStarted.Set();

    [LibraryImport("ole32.dll", EntryPoint = "CoInitializeEx")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial int InitializeCom(nint reserved, uint flags);

    [LibraryImport("ole32.dll", EntryPoint = "CoUninitialize")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial void UninitializeCom();

    [LibraryImport("ole32.dll", EntryPoint = "CoRegisterClassObject")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial int Register(
        ref Guid id,
        [MarshalAs(UnmanagedType.Interface)] IClassFactory factory,
        uint context,
        uint flags,
        out uint token
    );

    [LibraryImport("ole32.dll", EntryPoint = "CoRevokeClassObject")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial int Revoke(uint token);

    [GeneratedComInterface]
    [Guid("00000001-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal partial interface IClassFactory
    {
        [PreserveSig]
        uint CreateInstance(nint outer, in Guid requested, out nint instance);

        [PreserveSig]
        uint LockServer([MarshalAs(UnmanagedType.Bool)] bool locked);
    }

    [GeneratedComClass]
    private sealed partial class TaskFactory : IClassFactory
    {
        private int _activated;

        public uint CreateInstance(nint outer, in Guid requested, out nint instance)
        {
            instance = 0;
            if (outer != 0)
                return 0x80040110;
            if (requested != UnknownId && requested != typeof(IBackgroundTask).GUID)
                return 0x80004002;
            if (Interlocked.CompareExchange(ref _activated, 1, 0) != 0)
                return 0x80040111;
            instance = WinRT.MarshalInterface<IBackgroundTask>.FromManaged(
                new FacetBackgroundTask()
            );
            return 0;
        }

        public uint LockServer(bool locked)
        {
            _ = locked;
            return 0;
        }
    }
}
