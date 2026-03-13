Set-Location $PSScriptRoot
$GitHubUser = "miladreihanpour-programmer"
$RepoName = if ($args.Count -gt 0 -and $args[0]) { $args[0] } else { "fatamorgana" }
$BranchName = (git branch --show-current)
if (-not $BranchName) { $BranchName = "main" }

$SshKeyPath = if ($env:SSH_KEY_PATH) { $env:SSH_KEY_PATH } else { "C:/Users/$env:USERNAME/.ssh/id_ed25519_milad" }
$env:GIT_SSH_COMMAND = "ssh -i `"$SshKeyPath`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

$RemoteUrl = "git@github.com:$GitHubUser/$RepoName.git"

git remote get-url origin *> $null
if ($LASTEXITCODE -eq 0) {
	git remote set-url origin $RemoteUrl
} else {
	git remote add origin $RemoteUrl
}

git pull origin $BranchName
