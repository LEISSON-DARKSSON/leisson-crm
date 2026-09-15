' Starts only this CRM's absolute native Node launcher, without a console window.
Option Explicit
Dim files, shell, root, executable, script, command
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
executable = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
script = files.BuildPath(root, "agent\start-server.mjs")
If Not files.FileExists(executable) Or Not files.FileExists(script) Then WScript.Quit 2
command = Chr(34) & executable & Chr(34) & " " & Chr(34) & script & Chr(34)
WScript.Quit shell.Run(command, 0, True)
