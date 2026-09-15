' Leisson CRM - avab CRM-i APP-vaates (oma aken, ilma brauseri ribata).
' Kaivitab serveri, kui see veel ei jookse, ootab kuni port vastab, ja avab akna.
Option Explicit
Dim fso, sh, root, url, port, envTxt, i, line, parts
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' loe port .env-ist (vaikimisi 4310) - parooli me ei loe ega puutu
port = "4310"
If fso.FileExists(root & "\.env") Then
  Dim f
  Set f = fso.OpenTextFile(root & "\.env", 1)
  Do Until f.AtEndOfStream
    line = Trim(f.ReadLine)
    If Left(line, 9) = "CRM_PORT=" Then port = Trim(Mid(line, 10))
  Loop
  f.Close
End If
url = "http://127.0.0.1:" & port & "/"

' kas server juba vastab?
Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", url & "api/state", False
  http.Send
  If Err.Number = 0 Then If http.Status = 200 Then ServerUp = True
  On Error GoTo 0
End Function

If Not ServerUp() Then
  sh.Run """" & root & "\win\crm-server.vbs""", 0, False
  For i = 1 To 40          ' kuni 20 sekundit
    WScript.Sleep 500
    If ServerUp() Then Exit For
  Next
End If

' leia Chrome voi Edge ja ava app-vaates
Dim candidates, p, exe
candidates = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%LocalAppData%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") )

exe = ""
For Each p In candidates
  If exe = "" And fso.FileExists(p) Then exe = p
Next

If exe = "" Then
  sh.Run url, 1, False    ' varuvariant: tavaline brauser
Else
  sh.Run """" & exe & """ --app=" & url & " --window-size=1480,940 --window-position=80,60", 1, False
End If
