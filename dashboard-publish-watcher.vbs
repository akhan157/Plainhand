' Silent launcher for the dashboard publish watcher.
' wscript runs with zero console window, so the scheduled task never
' flashes a window or steals focus (e.g., from a fullscreen game).
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """C:\Program Files\nodejs\node.exe"" dashboard-publish-watcher.mjs", 0, False
