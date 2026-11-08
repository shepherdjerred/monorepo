@echo off
rem Puts MSYS2 fish on the Windows PATH. CHERE_INVOKING keeps the caller's
rem folder when fish starts as a login shell.
setlocal
set CHERE_INVOKING=1
"C:\msys64\usr\bin\fish.exe" %*
