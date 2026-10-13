$ErrorActionPreference = 'SilentlyContinue'
$wd = 'E:\Attendance_Web_App\Attendence_Mobile_App - Copy\Attendenc_New_Perfect_Mobile\web-next'
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $wd -RedirectStandardOutput "$wd\dev-recovery.log" -RedirectStandardError "$wd\dev-recovery-err.log" -WindowStyle Hidden
Write-Output 'STARTED'
