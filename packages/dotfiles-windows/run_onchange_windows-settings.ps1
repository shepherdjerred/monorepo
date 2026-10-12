$ErrorActionPreference = 'Stop'

$explorer = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
Set-ItemProperty $explorer -Name HideFileExt -Value 0 -Type DWord
Set-ItemProperty $explorer -Name Hidden -Value 1 -Type DWord
Set-ItemProperty $explorer -Name ShowTaskViewButton -Value 0 -Type DWord
Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Search' -Name SearchboxTaskbarMode -Value 0 -Type DWord

Set-ItemProperty 'HKCU:\Control Panel\Keyboard' -Name KeyboardDelay -Value '1'
Set-ItemProperty 'HKCU:\Control Panel\Keyboard' -Name KeyboardSpeed -Value '31'
# Disable the Shift x5 StickyKeys shortcut.
Set-ItemProperty 'HKCU:\Control Panel\Accessibility\StickyKeys' -Name Flags -Value '498'
