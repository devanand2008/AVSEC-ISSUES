param(
  [int[]]$Ports = @(3000, 4000),
  [switch]$Stop
)

$rows = Get-NetTCPConnection -LocalPort $Ports -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object {
    $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -match '^(node|npm|cmd|powershell)$') {
      [pscustomobject]@{
        Pid = $process.Id
        Name = $process.ProcessName
        Port = $_.LocalPort
      }
    }
  } |
  Sort-Object Pid, Port -Unique

if ($Stop) {
  $rows | Select-Object -ExpandProperty Pid -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  exit 0
}

$rows | ForEach-Object {
  "{0} {1} port {2}" -f $_.Pid, $_.Name, $_.Port
}
