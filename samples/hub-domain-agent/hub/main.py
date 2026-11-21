"""Start only the hub Hosted Agent server."""

import asyncio

from common.runtime import serve
from hub.agent import HubAgent
from hub.config import HubConfig

if __name__ == "__main__":
    asyncio.run(serve(HubAgent(HubConfig.from_env())))
