' Silent launcher for the dashboard publish watcher.
' wscript runs with zero console window, so the scheduled task never
' flashes a window or steals focus (e.g., from a fullscreen game).
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
repo = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
shell.CurrentDirectory = repo
shell.Run """C:\Program Files\nodejs\node.exe"" """ & repo & "\dashboard\node\dashboard-publish-watcher.mjs""", 0, False
