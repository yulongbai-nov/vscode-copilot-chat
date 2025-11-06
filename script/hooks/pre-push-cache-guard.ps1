<#
Runs during `git push` to prevent committing new simulation cache layers.
Copy this file to `.git/hooks/pre-push` and make it executable.
#>
$changedPaths = git diff --cached --name-only
if ($LASTEXITCODE -ne 0) {
	Write-Error 'Unable to determine staged changes.'
	exit 1
}
if ($changedPaths | Select-String '^test/simulation/cache/layers/') {
	Write-Error 'Simulation cache layers must not be pushed. Fetch from upstream instead.'
	exit 1
}
exit 0
