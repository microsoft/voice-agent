"""Start only the billing Hosted Agent server."""

import asyncio
import os

from billing.agent import BillingAgent
from common.config import Config
from common.runtime import serve

if __name__ == "__main__":
    asyncio.run(
        serve(BillingAgent(Config.from_env(), warmup=os.getenv("DOMAIN_MODEL_WARMUP", "true").lower() == "true"))
    )
