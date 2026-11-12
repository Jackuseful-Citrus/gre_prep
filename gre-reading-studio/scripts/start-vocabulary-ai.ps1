$ErrorActionPreference = 'Stop'
try {
    $projectDirectory = Split-Path -Parent $PSScriptRoot
    $pagePath = Join-Path $projectDirectory 'dist\index.html'
    if (-not (Test-Path -LiteralPath $pagePath -PathType Leaf)) { throw 'The webpage is missing. Keep the dist folder with the app.' }
    Start-Process -FilePath $pagePath
    Write-Host 'Enter your API key on the Vocabulary page. No background service is needed.'
} catch {
    Write-Host $_.Exception.Message
    exit 1
}
