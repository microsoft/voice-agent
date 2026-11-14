"""Create or update the dedicated public demo agent using the deployer's CLI login."""

import argparse
import asyncio

from azure.ai.projects.aio import AIProjectClient
from azure.ai.projects.models import VoiceAgentDefinition
from azure.identity.aio import AzureCliCredential

from vehicle_voice_agent import definition, project_endpoint


async def provision(endpoint: str, name: str, model: str, voice: str) -> None:
    async with AzureCliCredential() as credential, AIProjectClient(
        endpoint=project_endpoint(endpoint), credential=credential, allow_preview=True,
    ) as client:
        async with asyncio.timeout(120):
            await client.agents.create_version(
                agent_name=name, definition=VoiceAgentDefinition(definition(model, voice, False)),
            )
            await client.agents.enable(name)
        print(f"Public demo agent enabled: {name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--model", default="gpt-realtime-2.1")
    parser.add_argument("--voice", default="en-US-AvaNeural")
    args = parser.parse_args()
    asyncio.run(provision(args.endpoint, args.name, args.model, args.voice))
