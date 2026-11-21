# SDK packages

No SDK packages are bundled. Python samples install `azure-ai-projects` from PyPI
(2.11.0 or later for voice sessions and GPT Live), using the `[voice]` extra for SDK
voice connections, and JavaScript samples install `@azure/ai-projects` 2.11.0 from npm.
Use the requirements and `package.json` files under `samples/` to install the public
packages. The record below describes an earlier bundled .NET preview build.

The .NET sample installs the published
[`Azure.AI.Projects`](https://www.nuget.org/packages/Azure.AI.Projects/3.0.0-beta.3)
and [`Azure.AI.Projects.Agents`](https://www.nuget.org/packages/Azure.AI.Projects.Agents/3.0.0-beta.3)
3.0.0-beta.3 preview SDK packages from NuGet.org. No .NET packages are bundled. See the
[C# setup instructions](../samples/CSharp/README.md) for package and restore details.

## Historical .NET preview build record

The removed bundled package used the same `3.0.0-beta.3` version as the public
release but was a separate preview build. It is no longer a sample dependency.

- Source archive: `Azure.AI.Projects.Agents.3.0.0-beta.3-voice-samples.zip`
- Package: `Azure.AI.Projects.Agents.3.0.0-beta.3.nupkg`
- SDK repository commit recorded in package: `4c94d5d53db51d0fd8089a341ccbe11d4ff9f65d`
- SHA-256: `16f5214c679488943d103a32b7a0fff1321e08815f50400bf14c3f62f3e62329`
- License: MIT

## Portal package for Windows

[`portal-windows/`](portal-windows/README.md) holds `va-portal-v2.zip`, the Voice Agent portal for a
Windows x64 machine without internet access, with its own Python and every dependency. Its
[guide](portal-windows/README.md) covers setup, identity, networks that inspect HTTPS, the `agent.cmd`
command-line tool and troubleshooting.
