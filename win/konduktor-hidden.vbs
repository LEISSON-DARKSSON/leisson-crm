Option Explicit
Dim shell, files, script, executable, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
executable = WScript.Arguments(0)
script = files.GetAbsolutePathName(files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "..\agent\scheduled-run.mjs"))
If Not files.FileExists(executable) Or Not files.FileExists(script) Then WScript.Quit 2
command = Chr(34) & executable & Chr(34) & " " & Chr(34) & script & Chr(34)
WScript.Quit shell.Run(command, 0, True)
