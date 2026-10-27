[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectEndpoint,
    [string]$ResourceGroup = 'rg-qiliao-9160_ai',
    [string]$Location = 'southeastasia',
    [string]$AppName = 'aura-vehicle-demo-73cfc417',
    [string]$PlanName = 'aura-vehicle-demo-plan',
    [string]$IdentityName = 'aura-vehicle-demo-identity',
    [string]$Model = 'gpt-realtime-2.1',
    [string]$Voice = 'en-US-AvaNeural',
    [string]$Python = (Join-Path $PSScriptRoot '..\..\..\.venv\Scripts\python.exe')
)

$ErrorActionPreference = 'Stop'
function Invoke-Azure {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $result = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure command failed: az $($Arguments -join ' ')"
    }
    return $result
}

$endpoint = [uri]$ProjectEndpoint
if ($endpoint.Scheme -ne 'https' -or $endpoint.Host -notmatch '^[a-z0-9-]+\.services\.ai\.azure\.com$' -or
    $endpoint.AbsolutePath -notmatch '^/api/projects/[A-Za-z0-9._-]+$' -or
    $endpoint.UserInfo -or $endpoint.Query -or $endpoint.Fragment -or -not $endpoint.IsDefaultPort) {
    throw 'ProjectEndpoint must be a public Azure Foundry HTTPS project endpoint.'
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Provide -Python pointing to an interpreter with requirements.txt installed.'
}
$account = Invoke-Azure account show --output json | ConvertFrom-Json
$groupId = "/subscriptions/$($account.id)/resourceGroups/$ResourceGroup"
$identity = Invoke-Azure identity list --resource-group $ResourceGroup --query "[?name=='$IdentityName'] | [0]" --output json | ConvertFrom-Json
if (-not $identity) {
    $identity = Invoke-Azure identity create --resource-group $ResourceGroup --name $IdentityName --location $Location --tags purpose=vehicle-voice-demo --output json | ConvertFrom-Json
}
$foundry = Invoke-Azure cognitiveservices account show --resource-group $ResourceGroup --name $endpoint.Host.Split('.')[0] --query id --output tsv
$projectId = "$foundry/projects/$($endpoint.Segments[-1])"
$roleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'
$assignment = Invoke-Azure role assignment list --assignee-object-id $identity.principalId --scope $projectId --query "[?ends_with(roleDefinitionId, '$roleId')].id | [0]" --output tsv
if (-not $assignment) {
    Invoke-Azure role assignment create --assignee-object-id $identity.principalId --assignee-principal-type ServicePrincipal --role $roleId --scope $projectId --output none
}
$plan = Invoke-Azure appservice plan list --resource-group $ResourceGroup --query "[?name=='$PlanName'].id | [0]" --output tsv
if (-not $plan) {
    Invoke-Azure appservice plan create --resource-group $ResourceGroup --name $PlanName --location $Location --is-linux --sku B1 --number-of-workers 1 --tags purpose=vehicle-voice-demo --output none
} else {
    $capacity = Invoke-Azure appservice plan show --resource-group $ResourceGroup --name $PlanName --query sku.capacity --output tsv
    if ($capacity -ne '1') { throw 'The public demo requires a dedicated single-worker plan.' }
}
$app = Invoke-Azure webapp list --resource-group $ResourceGroup --query "[?name=='$AppName'] | [0]" --output json | ConvertFrom-Json
if (-not $app) {
    $app = Invoke-Azure webapp create --resource-group $ResourceGroup --plan $PlanName --name $AppName --runtime 'PYTHON:3.11' --assign-identity $identity.id --https-only true --tags purpose=vehicle-voice-demo --output json | ConvertFrom-Json
} else {
    if ($app.serverFarmId -ine "$groupId/providers/Microsoft.Web/serverfarms/$PlanName") {
        throw 'The existing app uses a different hosting plan.'
    }
    Invoke-Azure webapp identity assign --resource-group $ResourceGroup --name $AppName --identities $identity.id --output none
    Invoke-Azure webapp update --resource-group $ResourceGroup --name $AppName --https-only true --output none
}
$origin = "https://$($app.defaultHostName)"
$agentName = "vehicle-public-$AppName"
& $Python (Join-Path $PSScriptRoot 'provision_public_agent.py') --endpoint $ProjectEndpoint --name $agentName --model $Model --voice $Voice
if ($LASTEXITCODE -ne 0) { throw 'Public voice agent provisioning failed.' }

Invoke-Azure webapp config set --resource-group $ResourceGroup --name $AppName --startup-file 'python server.py --port 8000' --always-on true --web-sockets-enabled true --min-tls-version 1.2 --ftps-state Disabled --http20-enabled true --output none
Invoke-Azure webapp config appsettings set --resource-group $ResourceGroup --name $AppName --settings `
    "PUBLIC_ORIGIN=$origin" "AZURE_VOICE_AGENTS_ENDPOINT=$ProjectEndpoint" `
    "AZURE_VOICE_AGENTS_MODEL=$Model" "AZURE_VOICE_AGENTS_VOICE=$Voice" `
    "AZURE_VOICE_AGENT_NAME=$agentName" 'AZURE_CREDENTIAL_MODE=managed_identity' `
    "AZURE_CLIENT_ID=$($identity.clientId)" 'VOICE_SESSION_SECONDS=300' 'VOICE_STARTS_PER_DAY=20' `
    'DEMO_USAGE_DB=/home/data/vehicle-demo/usage.sqlite3' `
    'SCM_DO_BUILD_DURING_DEPLOYMENT=true' 'ENABLE_ORYX_BUILD=true' --output none

$packageDirectory = Join-Path ([IO.Path]::GetTempPath()) ("aura-deploy-" + [guid]::NewGuid().ToString('N'))
$zipPath = "$packageDirectory.zip"
New-Item -ItemType Directory -Path $packageDirectory | Out-Null
try {
    foreach ($name in @('server.py', 'hosting.py', 'vehicle.py', 'tool_contracts.py', 'browser_control.py', 'webiq_client.py', 'vehicle_voice_agent.py', 'audio.py', 'requirements.txt')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $packageDirectory
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'static') -Destination $packageDirectory -Recurse
    Compress-Archive -Path (Join-Path $packageDirectory '*') -DestinationPath $zipPath
    $previousId = Invoke-Azure webapp log deployment list --resource-group $ResourceGroup --name $AppName --query "[?message=='OneDeploy'] | [0].id" --output tsv
    Invoke-Azure webapp deploy --resource-group $ResourceGroup --name $AppName --type zip --src-path $zipPath --clean true --restart true --async true --track-status false --timeout 1200000 --output none
    $deadline = [DateTime]::UtcNow.AddMinutes(20)
    do {
        Start-Sleep -Seconds 15
        $deployment = Invoke-Azure webapp log deployment list --resource-group $ResourceGroup --name $AppName --query "[?message=='OneDeploy'] | [0]" --output json | ConvertFrom-Json
        if ($deployment -and $deployment.id -ne $previousId) {
            if ($deployment.status -eq 3) {
                Invoke-Azure webapp log deployment show --resource-group $ResourceGroup --name $AppName --deployment-id $deployment.id --output json | Write-Host
                throw "Azure deployment $($deployment.id) failed."
            }
            if ($deployment.status -eq 4) { break }
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            throw 'Azure build did not complete within 20 minutes. Check webapp deployment logs before retrying.'
        }
    } while ($true)
    $health = Invoke-RestMethod "$origin/health" -TimeoutSec 60 -MaximumRetryCount 12 -RetryIntervalSec 10
    if ($health.status -ne 'ok') { throw 'Public health check failed.' }
    Write-Host "Public demo deployed: $origin"
    Write-Host 'Anonymous access: one shared voice session, 5 minutes per session, 20 starts per rolling day.'
    Write-Host 'The B1 hosting plan bills continuously, in addition to Azure voice usage.'
} finally {
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
    Remove-Item -LiteralPath $packageDirectory -Recurse
}
