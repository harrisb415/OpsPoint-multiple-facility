; OpsPoint Setup for Windows (Inno Setup 6).
;
; Built by the release pipeline after scripts/build-windows.mjs has staged
;   release\windows\node\   Node.js (win-x64), checked against nodejs.org's SHASUMS256
;   release\windows\app\    the release bundle with its packages (npm ci --omit=dev)
; then:
;   ISCC /DAppVersion=2.8.0 packaging\windows\opspoint.iss   ->  release\OpsPoint-Setup-2.8.0.exe
;
; It copies the files, then runs opspoint.ps1 -Configure in a console: the same
; questions, colours and summary as the Linux installer (time zone, port, data
; folder, database), registers the service (a scheduled task at startup, as
; NETWORK SERVICE), waits for the health check and opens the setup link.
; Unattended: OpsPoint-Setup-x.y.z.exe /VERYSILENT /CONFIG=C:\path\answers.env

#ifndef AppVersion
  #error Pass the version: ISCC /DAppVersion=x.y.z packaging\windows\opspoint.iss
#endif
#ifndef StageDir
  #define StageDir "..\..\release\windows"
#endif

[Setup]
AppId={{6F2C9A41-8B3E-4D7A-9C55-0E1F3B7A2D90}
AppName=OpsPoint
AppVersion={#AppVersion}
AppVerName=OpsPoint {#AppVersion}
AppPublisher=OpsPoint
AppComments=Residential operations
DefaultDirName={autopf}\OpsPoint
DefaultGroupName=OpsPoint
DisableProgramGroupPage=yes
OutputDir=..\..\release
OutputBaseFilename=OpsPoint-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
PrivilegesRequired=admin
WizardStyle=modern
WizardImageFile=art\wizard.bmp,art\wizard-200.bmp
WizardSmallImageFile=art\header.bmp,art\header-200.bmp
SetupIconFile=art\opspoint.ico
UninstallDisplayIcon={app}\opspoint.ico
UninstallDisplayName=OpsPoint
CloseApplications=no

[Files]
Source: "{#StageDir}\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "opspoint.config.json,data\*"
Source: "opspoint.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "opspoint.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "art\opspoint.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; The service account writes the data folder and updates the app in place (the in-app updater).
Name: "{commonappdata}\OpsPoint"; Permissions: networkservice-modify
Name: "{app}\app"; Permissions: networkservice-modify

[Icons]
Name: "{group}\OpsPoint Setup"; Filename: "{app}\opspoint.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\opspoint.ico"; Comment: "Upgrade, health check, backup and export"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\opspoint.ps1"" -Configure {code:ConfigureArgs}"; \
  WorkingDir: "{app}"; StatusMsg: "Setting up OpsPoint…"; Flags: waituntilterminated

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\opspoint.ps1"" -RemoveService"; \
  RunOnceId: "RemoveService"; Flags: runhidden waituntilterminated

[UninstallDelete]
; The settings file holds this install's settings and any database password. The data folder stays.
Type: files; Name: "{app}\app\opspoint.config.json"
Type: filesandordirs; Name: "{app}\app\node_modules"

[Code]
const
  NAVY   = $00703A1E;   { #1E3A70 as Windows BGR }
  GOLD   = $002EB8F5;   { #F5B82E }
  SILVER = $00D3CBC5;   { #C5CBD3 }

{ /CONFIG=answers.env, and /SILENT or /VERYSILENT: the questions answer themselves. }
function ConfigureArgs(Param: String): String;
var
  Answers: String;
begin
  Result := '';
  Answers := ExpandConstant('{param:config|}');
  if Answers <> '' then
    Result := '-Config "' + Answers + '"';
  if WizardSilent then
    Result := Result + ' -Yes';
end;

{ The outer pages and the header in the icon's navy and gold; inner pages keep
  Windows' own colours, so every control stays readable. }
procedure InitializeWizard;
begin
  WizardForm.MainPanel.Color := NAVY;
  WizardForm.PageNameLabel.Font.Color := GOLD;
  WizardForm.PageDescriptionLabel.Font.Color := SILVER;
  WizardForm.WelcomePage.Color := NAVY;
  WizardForm.WelcomeLabel1.Font.Color := GOLD;
  WizardForm.WelcomeLabel2.Font.Color := SILVER;
  WizardForm.FinishedPage.Color := NAVY;
  WizardForm.FinishedHeadingLabel.Font.Color := GOLD;
  WizardForm.FinishedLabel.Font.Color := SILVER;
end;
