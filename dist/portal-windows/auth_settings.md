# Set up portal.env, step by step (va-portal-v2 on Windows)

Do the steps in order. Open the settings file from a Command Prompt:

```bat
cd /d C:\va-portal-v2
notepad portal.env
```

Write one `KEY=value` per line, with no spaces around `=` and no quotes. A line that starts with `#` is ignored; to turn a setting on, remove its `#`. Save the file after each change.

## Step 1. Set the project endpoint

```text
AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
```

Copy it from Foundry portal > your project > **Overview**.

## Step 2. Set the identity

Choose one. The identity you choose needs the **Foundry User** role on the project.

**Service principal (client ID and secret).** Set these three lines. Remove the `#` in front of the last two:

```text
AZURE_CLIENT_ID=<Application (client) ID>
AZURE_TENANT_ID=<Directory (tenant) ID>
AZURE_CLIENT_SECRET=<the secret's Value, not its Secret ID>
```

This machine must reach `https://login.microsoftonline.com` on port 443.

**Managed identity of an Azure VM.** Keep `AZURE_TENANT_ID` and `AZURE_CLIENT_SECRET` commented out. For a user-assigned identity, set `AZURE_CLIENT_ID=<identity client ID>`. For a system-assigned identity, leave `AZURE_CLIENT_ID=` empty.

**Your own Azure CLI sign-in.** Add `AZURE_CREDENTIAL_MODE=cli`, then run `az login` on this machine.

Do not set `REQUESTS_CA_BUNDLE` or `SSL_CERT_FILE` yet; Step 4 says when you need them. There is no `CA_CERT_FILE` setting.

## Step 3. Run check.cmd

```bat
check.cmd
```

If the last line is `Ready: run the start script.`, go to Step 5.

Otherwise take the first `FAIL` line, find the first row below that matches it, do what it says, save `portal.env` and run `check.cmd` again. Repeat until the last line is `Ready: run the start script.`

| If check.cmd shows | Do this |
|---|---|
| `... signed by a certificate this machine does not trust ...` (on any line) | Your network inspects HTTPS. Go to Step 4. |
| `FAIL  Project endpoint` | Fix `AZURE_VOICE_AGENTS_ENDPOINT` (Step 1). |
| `FAIL  Foundry address: cannot resolve ...` | This machine cannot resolve the project host. Check DNS; for a private endpoint, check its private DNS zone. |
| `FAIL  Identity: ... AADSTS7000215 ...` | The secret is wrong. Put the secret's **Value** in `AZURE_CLIENT_SECRET`, or create a new secret. |
| `FAIL  Identity: ... AADSTS700016 ...` | `AZURE_CLIENT_ID` is wrong, or the app is not in the tenant `AZURE_TENANT_ID`. |
| `FAIL  Identity: ... AADSTS90002 ...` | `AZURE_TENANT_ID` is wrong. |
| `FAIL  Identity: ... AADSTS53003 ...` | A Conditional Access policy blocks this sign-in. Ask your Microsoft Entra administrator to allow it from this machine. |
| `FAIL  Identity: no token as managed identity ...` | The VM has no managed identity, or `AZURE_CLIENT_ID` does not match it (Step 2). |
| `FAIL  Identity: no token as service principal ...` with a connection error or timeout | Allow HTTPS from this machine to `login.microsoftonline.com`. |
| `HTTP 401` or `HTTP 403` on `Foundry access` or `Voice endpoint` | Give the identity **Foundry User** on the project, wait a few minutes, run `check.cmd` again. |
| `FAIL  Foundry access: cannot connect ...` | Port 443 to the project is blocked. Check the firewall, proxy and routes. |
| `FAIL  Voice endpoint` or `WARN  Voice endpoint` | A proxy blocks WebSocket (`wss://`). Ask your network team to allow it to `*.services.ai.azure.com`, or to exclude that host from HTTPS inspection. |
| `FAIL  Local port` | Close the other `start.cmd` window, or set `DEMO_PORT=9528`. |

A `WARN` on `Foundry address` (public address) is fine if this machine can reach that address.

## Step 4. Only if check.cmd says a certificate is not trusted

Your network re-signs HTTPS with your organization's root certificate (CA), and Windows on this machine does not trust it. Fix it in one of the two ways below, then run `check.cmd` again.

**4a. Install the root CA in Windows (preferred).** Get the root CA file (for example `corp-root-ca.cer`) from your IT team. In a Command Prompt started with **Run as administrator**:

```bat
certutil -addstore -f Root C:\install\corp-root-ca.cer
```

You add nothing to `portal.env`.

**4b. If you cannot install it, add two variables.**

1. The file must be PEM (Base-64): a text file that starts with `-----BEGIN CERTIFICATE-----`. If yours is not, convert it:

   ```bat
   certutil -encode C:\install\corp-root-ca.cer C:\va-portal-v2\corp-root-ca.pem
   ```

   If your network also uses an intermediate CA, put it in the same file, after the root CA.
2. Add these two lines to `portal.env`, both with the same full path and no quotes:

   ```text
   REQUESTS_CA_BUNDLE=C:\va-portal-v2\corp-root-ca.pem
   SSL_CERT_FILE=C:\va-portal-v2\corp-root-ca.pem
   ```

   Set both. The first is used for HTTPS calls and sign-in, the second for the voice WebSocket. The file is added to the certificates Windows trusts, so it only needs your organization's CA.

If `check.cmd` still says the certificate is not trusted, ask your network team to exclude `*.services.ai.azure.com` and `login.microsoftonline.com` from HTTPS inspection.

## Step 5. Start the portal

```bat
start.cmd
```

Keep the window open. Open `http://127.0.0.1:9527/editor/` in a browser on the same machine (use your port if you changed `DEMO_PORT`). After any later change to `portal.env`, close the window and run `start.cmd` again.

## Example: the lines a service principal sets

```text
AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
AZURE_CLIENT_ID=<Application (client) ID>
AZURE_TENANT_ID=<Directory (tenant) ID>
AZURE_CLIENT_SECRET=<secret value>
```

If something still fails, send the full `check.cmd` output and the `VERSION` file, with the secret removed. For download, upgrade and other details, see the [guide](README.md).
