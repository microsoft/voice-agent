# Voice Agent portal for Windows: offline package

`va-portal-v2.zip` runs the Voice Agent portal on one Windows machine inside your network. It contains its own Python 3.12 and every dependency, already installed at fixed versions. The machine needs no Python, pip, git, Docker, Azure CLI or general internet access; it only needs to reach your Foundry project.

This guide is the complete reference for the package: setup, identity, networks that inspect HTTPS, the command-line tool, upgrade and troubleshooting.

If you only need what to put in `portal.env`, read [auth_settings.md](auth_settings.md).

```text
your computer --remote desktop--> Windows VM: browser -> portal on 127.0.0.1:9527 --HTTPS/WSS--> Foundry project
                                               (signs in as a managed identity or a service principal)
```

The portal only accepts connections from the machine it runs on. You sign in to the VM with remote desktop and open the portal in the browser on the VM ([Step 6](#step-6-open-the-portal)). This is by design: never expose port 9527 on the network.

The package also contains `agent.cmd`, a command-line tool that lists, publishes, edits, tests and deletes agents without a browser ([Step 7](#step-7-manage-agents-from-the-command-line-optional)).

Run every command in this guide in a **Command Prompt** (`cmd.exe`) on the VM, from the package folder `C:\va-portal-v2`, unless the step says PowerShell. In PowerShell, put `.\` in front of a script name, for example `.\check.cmd`. Replace every `<...>` placeholder before you run a command: Command Prompt treats `<` and `>` as redirection.

## Contents

- [What you need](#what-you-need)
- [Step 1. Give the machine access to your Foundry project](#step-1-give-the-machine-access-to-your-foundry-project)
- [Step 2. Download and verify the package](#step-2-download-and-verify-the-package)
- [Step 3. Extract and configure](#step-3-extract-and-configure)
- [Step 4. Check](#step-4-check)
- [Step 5. Start the portal](#step-5-start-the-portal)
- [Step 6. Open the portal](#step-6-open-the-portal)
- [Step 7. Manage agents from the command line (optional)](#step-7-manage-agents-from-the-command-line-optional)
- [Networks that inspect HTTPS](#networks-that-inspect-https)
- [Upgrade from an earlier package](#upgrade-from-an-earlier-package)
- [Remove](#remove)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [Settings reference: portal.env](#settings-reference-portalenv)
- [Command reference: scripts](#command-reference-scripts)
- [Command reference: agent](#command-reference-agent)
- [Package details](#package-details)

## What you need

| Item | Details |
|---|---|
| A Windows x64 machine | Windows Server 2016 or later, or Windows 10 or 11. About 300 MB of free disk. A browser on the machine, such as Microsoft Edge. An Azure VM needs no public IP. |
| Network from the machine | HTTPS and WebSocket (WSS), both on port 443, to your project host `<account>.services.ai.azure.com`. If the project uses a private endpoint, the machine must resolve that name to the private IP address. A service principal also needs HTTPS to `login.microsoftonline.com`. |
| Your Foundry project endpoint | Foundry portal > your project > **Overview** > project endpoint. It looks like `https://<account>.services.ai.azure.com/api/projects/<project>`. |
| An identity with the **Foundry User** role on the project | [Step 1](#step-1-give-the-machine-access-to-your-foundry-project). Assigning the role needs Owner, User Access Administrator or Role Based Access Control Administrator on the project. |
| Remote desktop to the VM | Azure Bastion in the Azure portal, or Remote Desktop Connection over your VPN ([Step 6](#step-6-open-the-portal)). |

## Step 1. Give the machine access to your Foundry project

The portal and `agent.cmd` call Foundry as one identity. Pick one option; it needs the **Foundry User** role on the project.

| Option | Use it when | What the machine must reach to get a token |
|---|---|---|
| A. Managed identity (recommended) | The machine is an Azure VM | Nothing outside the VM: the token comes from the Azure Instance Metadata Service (`169.254.169.254`) inside the VM |
| B. Service principal (client ID and secret) | The machine is not an Azure VM, or your organization does not use managed identities | `https://login.microsoftonline.com` on port 443 |
| C. Your own Azure CLI sign-in | The Azure CLI is installed on the machine, and you want changes made as you | `https://login.microsoftonline.com` on port 443 |

### Option A: managed identity

In the Azure portal:

1. Open the VM > **Security** > **Identity**. Turn on **System assigned**, or add a **User assigned** identity. For a user-assigned identity, note its **Client ID**.
2. Open the Foundry project > **Access control (IAM)** > **Add** > **Add role assignment**. Choose **Foundry User**, then **Managed identity**, and select the VM's identity.

Or with the Azure CLI, from Azure Cloud Shell or any computer that has it. Each command is on one line, so it works in Bash, PowerShell and Command Prompt:

```text
az identity create -g <rg> -n voice-agent-portal-vm-id
az vm identity assign -g <vm rg> -n <vm name> --identities <identity resource id>
az role assignment create --role "Foundry User" --assignee-object-id <identity principal id> --assignee-principal-type ServicePrincipal --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>/projects/<project>
```

In [Step 3](#step-3-extract-and-configure) you set `AZURE_CLIENT_ID` to the identity's client ID, or leave it empty for a system-assigned identity.

### Option B: service principal

Use an app registration in your Microsoft Entra tenant that has a client secret. You need its **Application (client) ID**, its **Directory (tenant) ID** and the secret's **Value** (Microsoft Entra admin center > **App registrations** > your app > **Overview** and **Certificates & secrets**).

Give the service principal **Foundry User** on the project: Foundry project > **Access control (IAM)** > **Add** > **Add role assignment** > **Foundry User** > **User, group, or service principal** > select the app. Or with the Azure CLI:

```text
az role assignment create --role "Foundry User" --assignee <application client id> --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>/projects/<project>
```

In [Step 3](#step-3-extract-and-configure) you put the three values in `portal.env`. The secret is then stored in that file as plain text: keep the package folder readable only by the people who run the portal, and rotate the secret as your policy requires.

### Option C: your own Azure CLI sign-in

Run `az login` in a Command Prompt on the machine, give your user account **Foundry User** on the project, and add `AZURE_CREDENTIAL_MODE=cli` to `portal.env` in [Step 3](#step-3-extract-and-configure). The portal then acts as you.

A new role assignment can take a few minutes to apply, whichever option you choose.

## Step 2. Download and verify the package

You need two files from the `dist/portal-windows` folder of this repository: `va-portal-v2.zip` (28.6 MiB) and `va-portal-v2.zip.sha256`.

**From a browser.** Open each file in this folder on GitHub and select **Download raw file**. The download comes from `github.com` and `raw.githubusercontent.com`.

**With git.** This contacts only `github.com` and fetches only this folder:

```text
git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/voice-agent.git
cd voice-agent
git sparse-checkout set dist/portal-windows
```

The two files are then in `voice-agent\dist\portal-windows`.

Copy both files to a folder on the VM, for example `C:\install`, through your usual file transfer path (a file share in your network, or copy and paste in remote desktop). Then check the zip in **PowerShell**:

```powershell
cd C:\install
(Get-FileHash .\va-portal-v2.zip -Algorithm SHA256).Hash -eq (Get-Content .\va-portal-v2.zip.sha256).Split(' ')[0]
Unblock-File .\va-portal-v2.zip
```

The second line must print `True`. If it prints `False`, the download is incomplete or changed: download it again. `Unblock-File` removes the mark Windows puts on files downloaded from the internet, so the extracted files do not carry it.

## Step 3. Extract and configure

Extract the zip to `C:\`, so the package folder is `C:\va-portal-v2`. In the same PowerShell window:

```powershell
Expand-Archive .\va-portal-v2.zip -DestinationPath C:\
```

Or right-click the zip > **Extract All**, and enter `C:\` as the destination. Another folder also works: the longest path inside the package is 132 characters, well under the 260-character Windows limit. This guide uses `C:\va-portal-v2`; replace it if you chose another folder.

Then open a **Command Prompt** and edit the settings:

```bat
cd /d C:\va-portal-v2
notepad portal.env
```

Set the endpoint, then the lines for the identity you chose in [Step 1](#step-1-give-the-machine-access-to-your-foundry-project):

| Identity | Lines in `portal.env` |
|---|---|
| All | `AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>` |
| A. Managed identity, user-assigned | `AZURE_CLIENT_ID=<identity client id>` |
| A. Managed identity, system-assigned | `AZURE_CLIENT_ID=` (empty) |
| B. Service principal | `AZURE_CLIENT_ID=<application client id>`, then remove the `#` in front of `AZURE_TENANT_ID` and `AZURE_CLIENT_SECRET` and set both: `AZURE_TENANT_ID=<tenant id>` and `AZURE_CLIENT_SECRET=<secret value>` |
| C. Azure CLI sign-in | `AZURE_CLIENT_ID=` (empty), and add a line `AZURE_CREDENTIAL_MODE=cli` |

A service principal's `portal.env` looks like this (made-up values):

```text
AZURE_VOICE_AGENTS_ENDPOINT=https://contoso-foundry.services.ai.azure.com/api/projects/voice
AZURE_CLIENT_ID=11111111-2222-3333-4444-555555555555
AZURE_TENANT_ID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
AZURE_CLIENT_SECRET=<secret value>
```

Write `KEY=value` with no spaces around `=` and no quotes. A line that starts with `#` is ignored. Leave `REQUESTS_CA_BUNDLE` and `SSL_CERT_FILE` commented out: you need them only in the case described in [Networks that inspect HTTPS](#networks-that-inspect-https). Save the file and close Notepad. Every setting is explained in [Settings reference: portal.env](#settings-reference-portalenv).

## Step 4. Check

```bat
check.cmd
```

It changes nothing, creates nothing and incurs no cost. A ready machine prints:

```text
PASS  Project endpoint: https://<account>.services.ai.azure.com/api/projects/<project>
PASS  Foundry address: <account>.services.ai.azure.com -> 10.0.1.5
PASS  Identity: managed identity <client id>
PASS  Foundry access: listed agents (3 on the first page)
PASS  Voice endpoint: WSS reachable (HTTP 404 for a made-up agent name, as expected)
PASS  Local port: 127.0.0.1:9527 is free

Ready: run the start script.
```

| Line | What it proves |
|---|---|
| `Project endpoint` | `AZURE_VOICE_AGENTS_ENDPOINT` is set and has the right shape. |
| `Foundry address` | The machine resolves the project host. `WARN ... (public address ...)` is fine if the machine can reach that public address; inside a network without internet access it must resolve to your private endpoint. |
| `Identity` | The machine got a token. It names the identity: `managed identity <client id>`, `service principal <client id>`, or `signed-in account <you@contoso.com>` for the Azure CLI. |
| `Foundry access` | HTTPS to the project works and the identity has a role on it. |
| `Voice endpoint` | A WebSocket (`wss://`) to the project works. It connects with a made-up agent name on purpose: HTTP 404 proves the path without starting a session. Some proxies pass HTTPS but block WebSocket, so this is a separate check. |
| `Local port` | Nothing else uses the portal's port on this machine. |

Fix every `FAIL` before you continue; see [Troubleshooting](#troubleshooting). The last line is `Not ready: fix the FAIL lines above, then run the check again.` until they are fixed.

## Step 5. Start the portal

```bat
start.cmd
```

It prints `Voice Agent portal: http://127.0.0.1:9527/editor/  (close this window to stop it)`. Keep this window open while you use the portal. To stop the portal, close the window, or press `Ctrl+C` and answer `Y` to `Terminate batch job (Y/N)?`.

The package has no service installer, so the portal runs only while this window is open:

- Disconnecting from remote desktop (for example closing the Bastion browser tab) keeps it running.
- Signing out of Windows or restarting the VM stops it. Sign in again and run `start.cmd`.

## Step 6. Open the portal

Sign in to the VM with remote desktop, then open **`http://127.0.0.1:9527/editor/`** in the browser on the VM. Do not use the VM's name or IP address in the browser: the portal refuses requests that do not come from the machine itself.

**A. Azure Bastion from the Azure portal.** Open the VM > **Connect** > **Bastion**, enter the VM's user name and password, and the VM's desktop opens in a browser tab. Your computer needs only a browser that can open the Azure portal. You need the **Reader** role on the VM, its network interface and the Bastion resource.

**B. Remote Desktop Connection.** If your computer can reach the VM's private IP address (for example over VPN), run `mstsc` on your computer and connect to that address.

In the portal you create and edit agents, edit their versions, and talk to them with your microphone in the voice playground.

## Step 7. Manage agents from the command line (optional)

`agent.cmd` uses the same `portal.env` and identity as the portal. The portal does not need to be running. Run it from a Command Prompt in `C:\va-portal-v2`:

```bat
agent.cmd check
agent.cmd list
agent.cmd publish examples\hotel_reservation\agent.json --name my-agent --mcp-url https://<your MCP server>/mcp
agent.cmd say my-agent "Hi, I want to book a room."
agent.cmd edit my-agent
agent.cmd versions my-agent
agent.cmd rollback my-agent 1
agent.cmd pull my-agent -o my-agent.json
agent.cmd delete my-agent
```

| Command | What it does |
|---|---|
| `check` | The checks of `check.cmd`, without the local port |
| `list` | Agents in the project |
| `publish` | Publishes an agent file as a new version |
| `say` | Text conversation: replies, handoffs, tool calls |
| `edit` | Opens the latest version in Notepad; publishes it if you changed it |
| `versions` | Every version of an agent |
| `rollback` | Makes version 1's content the latest again |
| `pull` | Saves an agent as a file you can edit and publish |
| `delete` | Deletes the whole agent; add `--version N` to delete one version |

`examples\` holds two sample agents, `hotel_reservation` and `customer_support`. Their tools name an MCP server without an address, so pass `--mcp-url` with an MCP server your Foundry project can reach. Every command and option is explained in [Command reference: agent](#command-reference-agent).

## Networks that inspect HTTPS

Some firewalls and proxies decrypt HTTPS and re-sign it with the organization's own root certificate (TLS inspection). Browsers on managed machines accept this because the organization installs its root certificate in Windows.

The portal, `check.cmd` and `agent.cmd` verify every HTTPS and WebSocket connection against the certificates **Windows trusts** (**Trusted Root Certification Authorities**), and also accept the public certificate list bundled with the package. So:

- **Your organization's root certificate is installed in Windows** (usual on managed machines): nothing to configure. Leave `REQUESTS_CA_BUNDLE` and `SSL_CERT_FILE` commented out.
- **It is not installed**: `check.cmd` prints a line such as `FAIL  Foundry access: HTTPS to <account>.services.ai.azure.com is signed by a certificate this machine does not trust. ...`. Do one of the following, then run `check.cmd` again:
  1. Install the root certificate in Windows. In a Command Prompt started with **Run as administrator**: `certutil -addstore -f Root C:\install\corp-root-ca.cer`. Or open `certlm.msc` > **Trusted Root Certification Authorities** > **Certificates** > **All Tasks** > **Import**. Your IT team can give you the certificate file.
  2. Point the package at the certificate file. It must be Base-64 (PEM): a text file that starts with `-----BEGIN CERTIFICATE-----`. Convert a binary `.cer` file with `certutil -encode corp-root-ca.cer corp-root-ca.pem`; if your network uses an intermediate certificate too, put both in the file. Then in `portal.env` remove the `#` from both lines and set the full path, without quotes:

     ```text
     REQUESTS_CA_BUNDLE=C:\va-portal-v2\corp-root-ca.pem
     SSL_CERT_FILE=C:\va-portal-v2\corp-root-ca.pem
     ```

     This file is added to the certificates Windows trusts; it does not replace them. A file that holds only your organization's certificate is therefore enough.
  3. Ask your network team to exclude `*.services.ai.azure.com` from HTTPS inspection, and `login.microsoftonline.com` too if you use a service principal or the Azure CLI.

Voice sessions use a WebSocket (`wss://`) to the same host. If `Foundry access` passes but `Voice endpoint` fails or warns, the proxy blocks or answers WebSocket connections itself: ask your network team for option 3 for `*.services.ai.azure.com`.

The Azure CLI (Option C) has its own Python and certificate settings; in a network that inspects HTTPS, configure it as your IT team describes for the Azure CLI.

## Upgrade from an earlier package

The earlier Windows package extracted to a folder named `voice-agent-portal-<commit>-win-x64`. To move to `va-portal-v2`:

1. Close the `start.cmd` window of the earlier package.
2. Download, check and extract `va-portal-v2.zip` as in [Step 2](#step-2-download-and-verify-the-package) and [Step 3](#step-3-extract-and-configure). It goes into `C:\va-portal-v2`, next to the earlier folder.
3. Open both `portal.env` files in Notepad. Copy the values of `AZURE_VOICE_AGENTS_ENDPOINT`, `AZURE_CLIENT_ID`, and, for a service principal, `AZURE_TENANT_ID` and `AZURE_CLIENT_SECRET` into the new file (remove the `#` in front of the last two). Keep the new file's comments; do not copy the old file over it.
4. Leave `REQUESTS_CA_BUNDLE` and `SSL_CERT_FILE` commented out at first, even if you set them in the earlier package. `va-portal-v2` already trusts the certificates Windows trusts. Set them only if `check.cmd` reports an untrusted certificate ([Networks that inspect HTTPS](#networks-that-inspect-https)).
5. In `C:\va-portal-v2`, run `check.cmd`, then `start.cmd`.

Your agents live in Foundry, so nothing is lost. Delete the earlier folder when the new one works. A later package works the same way: extract it next to this one and copy the values.

## Remove

Close the `start.cmd` window, then in a Command Prompt:

```bat
cd /d C:\
rmdir /s /q C:\va-portal-v2
rmdir /s /q "%USERPROFILE%\.voice-agent-portal"
```

Remove the role assignment from the Foundry project if you no longer need it, and delete the service principal's secret if you created one for the portal.

## Troubleshooting

Run `check.cmd` first: it names the step that fails. In this table, `...` stands for the rest of the line.

### Setup

| You see | Cause | What to do |
|---|---|---|
| `Get-FileHash ...` prints `False` | The download is incomplete or changed | Download both files again ([Step 2](#step-2-download-and-verify-the-package)). |
| **Extract All**: `The file name(s) would be too long for the destination folder` | The destination folder is very deep | Extract to `C:\` ([Step 3](#step-3-extract-and-configure)). |
| `'check.cmd' is not recognized as an internal or external command` | The Command Prompt is not in the package folder | `cd /d C:\va-portal-v2`, then run it again. |
| PowerShell: `The term 'check.cmd' is not recognized ...` | PowerShell does not run scripts from the current folder by name | Type `.\check.cmd` (or `.\start.cmd`, `.\agent.cmd`). |
| Windows says `python.exe` or the app was blocked | An application control policy (for example AppLocker or Smart App Control) does not allow programs from this folder | Ask your administrator to allow `C:\va-portal-v2\python\python.exe`. |
| `FAIL  Project endpoint: set AZURE_VOICE_AGENTS_ENDPOINT in portal.env ...`, or `start.cmd` prints `ERROR: set AZURE_VOICE_AGENTS_ENDPOINT in "C:\va-portal-v2\portal.env", then run check.cmd` | The endpoint is empty, still the placeholder, or not a project endpoint | Copy the project endpoint from Foundry portal > your project > **Overview** into `portal.env`. |

### Identity

| You see | Cause | What to do |
|---|---|---|
| `FAIL  Identity: no token as managed identity (ManagedIdentityCredential: ...)` | The machine has no managed identity, it is not an Azure VM, or `AZURE_CLIENT_ID` does not match the identity | [Option A](#option-a-managed-identity). For a system-assigned identity leave `AZURE_CLIENT_ID` empty. On a machine that is not an Azure VM, use [Option B](#option-b-service-principal). |
| `WARN  Identity: token is for <id>, not AZURE_CLIENT_ID <id>` | Another identity answered than the one in `AZURE_CLIENT_ID` | Check the client ID in `portal.env` against the identity or app registration. |
| `FAIL  Identity: no token as service principal (EnvironmentCredential: ... AADSTS7000215 ...)` | The secret is wrong or expired | Put the secret's **Value** in `AZURE_CLIENT_SECRET`, not its **Secret ID**. Create a new secret if it expired. |
| `... AADSTS700016 ...` | No app with that client ID in that tenant | Check `AZURE_CLIENT_ID` (the **Application (client) ID**) and `AZURE_TENANT_ID`. |
| `... AADSTS90002 ...` | No tenant with that ID | Check `AZURE_TENANT_ID` (the **Directory (tenant) ID**). |
| `... AADSTS53003 ...` | A Conditional Access policy in your tenant blocks this sign-in | Ask your Microsoft Entra administrator to allow the service principal from this machine. |
| `FAIL  Identity: ... HTTPS to login.microsoftonline.com is signed by a certificate this machine does not trust ...` | Your network inspects HTTPS to Microsoft Entra ID | [Networks that inspect HTTPS](#networks-that-inspect-https). |
| `FAIL  Identity: no token as service principal (...)` with a connection error or timeout | The machine cannot reach `login.microsoftonline.com` on port 443 | Allow HTTPS to `login.microsoftonline.com` in your firewall or proxy. |
| `FAIL  Identity: no token as cli (...)` | `az login` was not run on this machine, or it expired | Run `az login`, or remove `AZURE_CREDENTIAL_MODE=cli` to use a managed identity or service principal. |

### Network and access

| You see | Cause | What to do |
|---|---|---|
| `FAIL  Foundry address: cannot resolve <account>.services.ai.azure.com: ...` | The machine cannot resolve the project host name | Check the DNS settings of the virtual network and, for a private endpoint, its private DNS zone. |
| `FAIL  Foundry access: HTTP 401: ...` or `HTTP 403: grant this identity the 'Foundry User' role on the project (Access control (IAM))` | The identity has no role on this project, or the assignment is still applying | Assign **Foundry User** on the project (not only on the resource group), wait a few minutes, run `check.cmd` again. |
| `FAIL  Foundry access: HTTPS to <account>.services.ai.azure.com is signed by a certificate this machine does not trust ...` | Your network inspects HTTPS and Windows does not trust its root certificate | [Networks that inspect HTTPS](#networks-that-inspect-https). |
| `FAIL  Foundry access: cannot connect: ...` | Port 443 to the project is blocked | Check network security groups, firewall rules (including Windows Defender Firewall outbound rules), proxies and routes from the machine to the project. |
| `FAIL  Voice endpoint: cannot open WSS to <host>: ... A proxy or firewall may block WebSocket (wss://) even when HTTPS works.` | A proxy or firewall blocks WebSocket connections | Ask your network team to allow WebSocket to `*.services.ai.azure.com`, or to exclude it from HTTPS inspection. |
| `WARN  Voice endpoint: WSS handshake HTTP <code> (expected 404 for a made-up agent name): a proxy may be answering instead of Foundry ...` | A proxy answered the WebSocket request instead of Foundry | Same as above. The portal lists agents, but voice sessions may not connect. |
| The portal lists agents, but a voice session does not connect | WebSocket to the project is blocked | Run `check.cmd` and read the `Voice endpoint` line. |

### Portal

| You see | Cause | What to do |
|---|---|---|
| `FAIL  Local port: 127.0.0.1:9527 is in use: stop the other process or set DEMO_PORT` | Another program, or a portal you started earlier, uses the port | Close the other `start.cmd` window. Otherwise `netstat -ano` shows the process ID that uses `127.0.0.1:9527` in its last column; end it in Task Manager, or set another `DEMO_PORT` in `portal.env`. |
| Browser: `This portal only accepts localhost requests.` | The page was opened with another host name, for example the VM's name | Open `http://127.0.0.1:9527/editor/` in the browser on the VM. |
| Browser cannot connect | The `start.cmd` window was closed or shows an error, Windows was signed out or restarted, or you used the VM's IP address (the portal listens on `127.0.0.1` only) | Read the `start.cmd` window, run `start.cmd` again, and use `127.0.0.1` in the browser on the VM. |
| The project picker in the portal stays empty | The picker needs read access through Azure Resource Manager | Nothing to fix: the portal uses the project in `portal.env`. |

If you report a problem, include the output of `check.cmd`, the `VERSION` file, and the `conversation_id` that `agent.cmd say` prints. Remove the secret and any other private values first.

## Limits

- Everyone who uses the portal or `agent.cmd` on this machine acts as its identity: they can publish and delete agents in the project and start sessions that incur cost.
- With a service principal, `portal.env` holds the client secret as plain text.
- The portal runs only while the `start.cmd` window is open. The package does not install a Windows service and does not start at boot.
- The portal works with the project in `portal.env`. Its project picker needs read access through Azure Resource Manager and may stay empty.
- If the machine cannot reach `<region>.tts.speech.microsoft.com`, the portal uses its built-in voice list.
- Avatar video and other WebRTC features need extra network paths from the browser and may not work in a restricted network.
- Agents call their tools (MCP servers) from Foundry, not from this machine. Use MCP servers that your Foundry project can reach.

## Settings reference: portal.env

`portal.env` is in the package folder. Open it with `notepad portal.env`. One `KEY=value` per line, no spaces around `=`, no quotes; a line that starts with `#` is ignored. `check.cmd`, `start.cmd` and `agent.cmd` read it every time they run, so restart the portal after a change.

| Key | Required | Meaning |
|---|---|---|
| `AZURE_VOICE_AGENTS_ENDPOINT` | Yes | Project endpoint, `https://<account>.services.ai.azure.com/api/projects/<project>`. |
| `AZURE_CLIENT_ID` | For a user-assigned managed identity or a service principal | The identity's client ID, or the app's **Application (client) ID**. Empty for a system-assigned identity. |
| `AZURE_TENANT_ID` | For a service principal | The **Directory (tenant) ID**. |
| `AZURE_CLIENT_SECRET` | For a service principal | The client secret's **Value**. Setting it switches the identity from managed identity to service principal. |
| `AZURE_CREDENTIAL_MODE` | No | `cli` to act as your Azure CLI sign-in (`az login`). |
| `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE` | No | Full path to an extra root certificate file (Base-64/PEM), added to the certificates Windows trusts. Set both or neither. See [Networks that inspect HTTPS](#networks-that-inspect-https). |
| `DEMO_PORT` | No | Port of the portal on `127.0.0.1`. Default `9527`. |
| `VOICE_PORTAL_RECORD_SESSIONS` | No | `true` saves a log of each voice session in `%USERPROFILE%\.voice-agent-portal\sessions` for troubleshooting; values that look like keys, tokens or passwords are redacted. `false` in the delivered file. |
| `EDITOR` | No | Editor for `agent.cmd edit`, for example `EDITOR=code --wait`. Default: Notepad. |

## Command reference: scripts

Run each script from a Command Prompt in the package folder. To see a script's exit code afterwards, run `echo %ERRORLEVEL%`.

| Command | What it does | Options | Changes anything |
|---|---|---|---|
| `check.cmd` | Checks `portal.env`, name resolution, the identity, HTTPS and WebSocket access to the project, and the local port. Prints one `PASS`, `WARN` or `FAIL` line per check. Exit code 0 means ready; 1 means a check failed. | None | No |
| `start.cmd` | Starts the portal on `127.0.0.1` with the endpoint and port from `portal.env`. It runs in its window until you close the window or press `Ctrl+C`. | None: set `DEMO_PORT` in `portal.env` to change the port | Starts the portal |
| `agent.cmd <command>` | Lists, publishes, edits, rolls back, tests and deletes agents without a browser. | See [Command reference: agent](#command-reference-agent) | Depends on the command |

`start.cmd` uses the portal's defaults for the model and voice of new agents; choose both in the editor.

## Command reference: agent

`agent.cmd` lists, publishes, edits, rolls back, tests and deletes Foundry Voice Agents from a Command Prompt. It needs no browser and no running portal. It reads `portal.env`, talks only to the project endpoint in it, over HTTPS and WSS, and acts as the identity from [Step 1](#step-1-give-the-machine-access-to-your-foundry-project).

In the examples below, a line that starts with `>` is what you type in the Command Prompt; the other lines are what the command prints.

### General syntax

```text
agent.cmd [--project-endpoint URL] COMMAND [options]
```

| Option | Meaning |
|---|---|
| `--project-endpoint URL` | Use this project instead of `AZURE_VOICE_AGENTS_ENDPOINT` from `portal.env`. Put it before the command. |
| `--help` | `agent.cmd --help` lists the commands; `agent.cmd COMMAND --help` lists one command's options. |

Exit code `0` means success, `1` means failure; `echo %ERRORLEVEL%` shows it, and `if errorlevel 1` tests it in a batch file. Errors are one line that starts with `ERROR:`; some add a `Hint:` line. File paths are relative to the folder you run the command from. Put double quotes around any argument that contains spaces.

### check

Read-only checks: project endpoint, name resolution, identity, project access and the voice endpoint. It changes nothing, creates nothing and incurs no cost.

```text
>agent.cmd check
PASS  Project endpoint: https://<account>.services.ai.azure.com/api/projects/<project>
PASS  Foundry address: <account>.services.ai.azure.com -> 10.0.1.5
PASS  Identity: service principal <client id>
PASS  Foundry access: listed agents: the identity has a role on the project
PASS  Voice endpoint: WSS reachable (HTTP 404 for a made-up agent name, as expected)

Ready: try `agent.cmd list`.
```

No options. Exit code `1` if any line is `FAIL`. The lines mean the same as in [Step 4](#step-4-check).

### list

Agents in the project, with the latest version number, kind and model. No options.

```text
>agent.cmd list
support-agent                            v1     voice   gpt-realtime
my-agent                                 v3     voice   gpt-realtime
```

An empty project prints `No agents in this project.`

### show

One version of an agent: a summary, or the full stored JSON.

```text
agent.cmd show NAME [--version V] [--json]
```

| Option | Meaning |
|---|---|
| `--version V` | Show version `V` instead of the latest. |
| `--json` | Print the full version as JSON (definition, description, metadata). |

```text
>agent.cmd show my-agent
agent:       my-agent:1
created:     2026-11-17 07:19 UTC
description: A fictional hotel reservations Voice Agent for the Grand Hotel ...
model:       gpt-realtime
nodes:       $entrypoint, welcome, new_booking, manage_existing, general_inquiry, wrap_up, end
fingerprint: 8936bd1b13cb8304
mcp:         mock_tool_call -> https://<your MCP server>/mcp
```

`nodes` lists the handoff nodes (`(flat, no handoff)` for an agent without them). `fingerprint` is a short hash of the stored definition: two versions with the same fingerprint have the same definition. To save the JSON to a file, use `pull`, or redirect: `agent.cmd show my-agent --json > my-agent-full.json`.

### versions

Every version of an agent, newest first, with creation time, model and fingerprint. No options.

```text
>agent.cmd versions my-agent
v3     2026-11-17 07:20 UTC  gpt-realtime             8936bd1b13cb8304
v2     2026-11-17 07:19 UTC  gpt-realtime             a9108a647a541df4
v1     2026-11-17 07:19 UTC  gpt-realtime             8936bd1b13cb8304
```

Here `v3` has the same fingerprint as `v1`: it was made with `agent.cmd rollback my-agent 1`.

### pull

Save a version as an `agent.json` file you can edit and publish again.

```text
agent.cmd pull NAME [--version V] [-o FILE]
```

| Option | Meaning |
|---|---|
| `--version V` | Save version `V` instead of the latest. |
| `-o FILE`, `--output FILE` | Write to `FILE`. Default: `NAME.json` in the current folder. An existing file is overwritten. |

```text
>agent.cmd pull my-agent --version 1 -o v1.json
Saved my-agent:1 to v1.json
Edit it, then publish it:  agent.cmd publish v1.json
```

The file has `name`, `description` and `definition`, the same layout as the files in `examples\`. Open it with `notepad v1.json`.

### publish

Publish a file as a new version of an agent, then read the version back and stop with an error if Foundry stored something different. The agent is created if it does not exist.

```text
agent.cmd publish FILE [--name NAME] [--model MODEL] [--mcp-url URL] [--description TEXT] [--dry-run]
```

`FILE` is an `agent.json` (`name`, `description`, `definition`), a `pull` result, or a bare definition.

| Option | Meaning |
|---|---|
| `--name NAME` | Agent name in the project. Default: the `name` field of the file. Required for a bare definition. |
| `--model MODEL` | Replace `definition.model`, for example `gpt-realtime-mini`. |
| `--mcp-url URL` | Use this `server_url` for every MCP tool in the file. Required when a tool has no `server_url`, as in the files in `examples\`. Foundry calls this address, not this machine. |
| `--description TEXT` | Replace the description from the file. Put the text in double quotes. |
| `--dry-run` | Check the file and print the summary only. Needs no network and no sign-in. |

```text
>agent.cmd publish examples\hotel_reservation\agent.json --name my-agent --mcp-url https://<your MCP server>/mcp
agent:       my-agent
model:       gpt-realtime
nodes:       $entrypoint, welcome, new_booking, manage_existing, general_inquiry, wrap_up, end
fingerprint: 46b919eb58ffd1c6
mcp:         mock_tool_call -> https://<your MCP server>/mcp
published:   my-agent:1 (read back and matched; stored fingerprint 8936bd1b13cb8304)
Try it:      agent.cmd say my-agent "Hello"
```

- The first `fingerprint` is your file's; the `stored fingerprint` is what Foundry saved, after it added default fields. Compare the stored one with `versions` and `show`.
- If the content equals the latest version, Foundry keeps that version and no new one is created: `unchanged:   identical to the latest version my-agent:1; no new version created`.
- With `--dry-run` the last line is `dry run: nothing published`.

### edit

Open the latest version in a text editor and publish it as a new version if you changed it. It lists what changed and asks before publishing.

```text
agent.cmd edit NAME [--yes]
```

| Option | Meaning |
|---|---|
| `--yes` | Publish without asking. |

The editor is Notepad, unless `VISUAL` or `EDITOR` is set. Save the file and close the editor to continue. To use another editor for one Command Prompt session, set it first, for example `set EDITOR=code --wait`. The editor must keep running until you close the file: Visual Studio Code needs `--wait`.

```text
>agent.cmd edit my-agent
Editing my-agent:1 in C:\Users\<you>\.voice-agent-portal\agent-edits\my-agent.json. Save and close the editor to continue.
Changes: instructions changed
Publish these changes as a new version of my-agent? [y/N] y
published:   my-agent:2 (read back and matched; stored fingerprint a9108a647a541df4)
previous:    my-agent:1 is kept; undo with: agent.cmd rollback my-agent 1
```

- Nothing changed: `No changes; nothing published.`
- You answer `n`: nothing is published, and the command prints where your edits are and how to publish them later.
- The file is not valid JSON: it prints the line and column and asks `Open the editor again to fix it? [y/N]`. If you answer `n`, nothing is published and your edits stay in that file.
- The version you started from is also saved, as `%USERPROFILE%\.voice-agent-portal\agent-edits\my-agent.v1.json`.
- If `No changes; nothing published.` appears as soon as Notepad opens, Notepad was already open and took the file into its existing window, so the command did not wait for you. Close every Notepad window and run `edit` again, or use `pull`, edit the file, then `publish`.

### rollback

Publish the content of an older version (definition and description) as the new latest version. Older versions are never changed.

```text
agent.cmd rollback NAME VERSION [--yes]
```

| Option | Meaning |
|---|---|
| `--yes` | Do not ask for confirmation. |

```text
>agent.cmd rollback my-agent 1
Publish the content of my-agent:1 as a new latest version? [y/N] y
published:   my-agent:3 (read back and matched; stored fingerprint 8936bd1b13cb8304)
rolled back: the latest version now has the content of version 1
```

If the latest version already has that content: `The latest version (3) already has the content of version 1.` Nothing is published.

### say

A text conversation with a published agent. Each caller turn is sent as text; the command prints the agent's replies, handoffs between nodes, tool calls and errors. It does not send or play audio, so it tests prompts, handoffs and tools, not speech recognition or voices. Each conversation incurs a small model cost.

```text
agent.cmd say NAME ["TURN" ...] [--timeout SECONDS] [--save FILE]
```

| Option | Meaning |
|---|---|
| `"TURN" ...` | Caller turns, in order, one argument each in double quotes. With none, type one turn per line and press Enter on an empty line to start. |
| `--timeout SECONDS` | Seconds of silence that count as a stall (default 45). |
| `--save FILE` | Also write the conversation to `FILE` as JSON: every turn with reply, node, tools, handoffs, errors and outcome. |

```text
>agent.cmd say my-agent "Hi, I want to book a room." "Two nights from Friday, for two adults."
  agent (start)> Welcome to the Grand Hotel. I'm Celia. What can I help you arrange?

caller> Hi, I want to book a room.
  handoff> $entrypoint -> welcome
  handoff> welcome -> new_booking
  agent (new_booking)> Booking a room sounds great. Let's begin with your check-in and check-out dates. When will you be arriving?

caller> Two nights from Friday, for two adults.
  agent (new_booking)> Friday for two nights, and two adults. Which Friday did you have in mind?

conversation_id: conv_<id>
```

- A tool call shows as `  tool> <tool name>`, an error as `  error> ...`.
- If the agent says nothing for `--timeout` seconds, the turn shows `  outcome> stalled` and later turns are not sent. If the agent ends the call, it shows `  outcome> ended`.
- Exit code `1` when any turn has an error or a stall, so you can use `say` in a batch file with `if errorlevel 1`.
- Keep the `conversation_id` if you need to report a problem.

### delete

Delete one version, or the whole agent with every version. This cannot be undone.

```text
agent.cmd delete NAME [--version V] [--yes]
```

| Option | Meaning |
|---|---|
| `--version V` | Delete only version `V`. |
| `--yes` | Do not ask for confirmation. |

```text
>agent.cmd delete my-agent --version 1
Delete my-agent:1? This cannot be undone. [y/N] y
deleted my-agent:1
```

Any answer other than `y` prints `Cancelled.` and deletes nothing.

### Common errors

| You see | Cause | What to do |
|---|---|---|
| `ERROR: could not get a token for Foundry. ...` | The identity in `portal.env` cannot sign in | Run `agent.cmd check`; the `Identity` line names the cause. See [Troubleshooting](#identity). |
| `... returned HTTP 403: ...` followed by `Hint: this identity needs the 'Foundry User' role (or higher) on the project` | The identity has no role on the project, or the assignment is still applying | Assign **Foundry User** on the project, wait a few minutes, run `agent.cmd check`. |
| `ERROR: GET /agents/my-agent returned HTTP 404: Agent my-agent doesn't exist ...` | No agent with that name in this project | `agent.cmd list` shows the names. |
| `ERROR: GET /agents/my-agent/versions/1 returned HTTP 404: ...` | That version was deleted or never existed | `agent.cmd versions my-agent` shows the versions. |
| ``ERROR: the voice endpoint refused the connection: HTTP 404 (no agent named my-agent in this project; `agent.cmd list` shows the agents)`` | `say` with a name that does not exist | Check the name with `agent.cmd list`. |
| `ERROR: MCP server(s) mock_tool_call have no server_url; set it in the file or pass --mcp-url` | A tool in the file has no MCP server address | Pass `--mcp-url` with an MCP server your Foundry project can reach. |
| `The system cannot find the file specified.` right after a `publish` or `say` command | A `<...>` placeholder was left in the command; Command Prompt read `<` as redirection | Replace every `<...>` with a real value. |
| `ERROR: my-agent.json is not valid JSON: line 1, column 17: ...` | The file has a JSON syntax error | Fix the file at that line and column. |

## Package details

| Item | Value |
|---|---|
| File | `va-portal-v2.zip`, 29,965,455 bytes, one top folder `va-portal-v2` |
| SHA-256 | `c26b1e51741d941d7a36b48899f379fc36976c2ed034d4db82d727afa39f44c4` (also in `va-portal-v2.zip.sha256`) |
| Platform | Windows x64 |
| Python | CPython 3.12.16, bundled in `python\` |
| Portal source | `voice-agent` commit `d112175c0dcb355902d6129d5a09dbf279cd39ee`, plus the `va-portal-v2` changes below |

Changes in `va-portal-v2` compared with the earlier Windows package:

- HTTPS and WebSocket connections trust the certificates Windows trusts, so a network that inspects HTTPS works without extra settings when its root certificate is installed in Windows. `REQUESTS_CA_BUNDLE` and `SSL_CERT_FILE` now add a certificate instead of replacing the trusted list.
- `check.cmd` and `agent.cmd check` support a service principal, name the identity in use, print the real reason when sign-in fails, and explain certificate errors.
- `check.cmd` also checks the voice WebSocket endpoint.
- The folder name is short, `va-portal-v2`, to keep paths far from the Windows path length limit.

Inside the package:

| Path | Contents |
|---|---|
| `check.cmd`, `start.cmd`, `agent.cmd` | The three commands in this guide |
| `portal.env` | Settings ([Settings reference](#settings-reference-portalenv)) |
| `app\portal\` | The portal |
| `app\docs\`, `app\samples\` | Portal documentation and samples, shown in the portal |
| `examples\` | Two sample agents for `agent.cmd publish` |
| `python\` | The bundled Python with every dependency installed |
| `requirements.lock` | Exact versions of the installed Python packages |
| `VERSION` | Portal commit, Python build and package date |
| `LICENSE.md`, `LICENSE-IMAGE.md`, `THIRD_PARTY_LICENSES.txt` | Licenses of the portal, the Python build and the bundled packages |
| `README.md` | A short summary; this guide replaces it for Windows |
