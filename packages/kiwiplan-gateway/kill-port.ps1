$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
    Write-Host "Killed PID $($conn.OwningProcess)"
} else {
    Write-Host "No listener on 3001"
}
