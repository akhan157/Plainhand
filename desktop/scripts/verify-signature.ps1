param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -FilePath $Path
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=SignPath Foundation(?:,|$)') {
  throw "Missing valid SignPath Foundation signature: $Path"
}
