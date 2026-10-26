# SDK packages

Python samples now install `azure-ai-projects>=2.7.0`
from PyPI, using the `[voice]` extra for SDK voice connections. Use the
requirements files under `samples/` to install the public package.

The [GPT Live samples](../samples/gpt_live/README.md) are the exception: they
install the bundled preview wheel below, which adds the GPT Live agent models
that are not yet in a PyPI release.

## Bundled Python preview build: azure-ai-projects 2.10.0

`azure_ai_projects-2.10.0-py3-none-any.whl` is the unmodified wheel published by
the Azure SDK for Python pull-request pipeline. It is a preview build, not a
release; PyPI's latest release was 2.9.0 when it was added.

- Source: [Azure/azure-sdk-for-python#49629](https://github.com/Azure/azure-sdk-for-python/pull/49629),
  "[azure-ai-projects] Emit GPT Live APIs from TypeSpec" (draft, targeting `feature/azure-ai-projects/vnext`)
- PR head commit: [`ede03b49d28fdb682cd199946d83825c55e4f956`](https://github.com/Azure/azure-sdk-for-python/commit/ede03b49d28fdb682cd199946d83825c55e4f956)
- Build: [azure-sdk/public build 6995855](https://dev.azure.com/azure-sdk/public/_build/results?buildId=6995855&view=artifacts&pathAsName=false&type=publishedArtifacts)
  (`python - pullrequest`, 20261023.42), artifact `packages_linux`
- Adds: `VoiceAgentLiveDefinition`, Live delegation and event models, and
  `beta.voice_agents.live_conversations`. It has no Live WebSocket client; that is
  planned in the follow-up PR
  [Azure/azure-sdk-for-python#49631](https://github.com/Azure/azure-sdk-for-python/pull/49631), so the samples keep the OpenAI Live SDK for audio.
- SHA-256: `0204c8ab4959496973aa64398829c5346f36d9bc93a1f07ceb58c07d5f6f8e6f`
- License: MIT

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

## Historical Python preview build record

The removed preview wheel was built from the unmodified
`sdk/ai/azure-ai-projects` package in the Azure SDK for Python repository.
This record describes the SDK used for the September 16-17 evaluations,
not a current sample dependency.

- Branch: [`xitzhang/voice-agent-pupr`](https://github.com/Azure/azure-sdk-for-python/tree/xitzhang/voice-agent-pupr/sdk/ai/azure-ai-projects)
- Commit: [`f84c5330f4246892455f33fccdf9503a774ecf66`](https://github.com/Azure/azure-sdk-for-python/tree/f84c5330f4246892455f33fccdf9503a774ecf66/sdk/ai/azure-ai-projects)
- Package version: `2.7.0b1`
- Built: September 15, 2026, using Python 3.12.10 on Windows (`core.autocrlf=false`, LF checkout)
- Build tools: `build==1.6.0`, `setuptools==84.0.0`, `wheel==0.48.0`
- SHA-256: `f857a1281e2fa3414f25e02aed95dfe2275495027b0a764f38921a8589f15e75`
