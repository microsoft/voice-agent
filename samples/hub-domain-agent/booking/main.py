"""Start only the booking Hosted Agent server."""

import asyncio
import os

from booking.agent import BookingAgent
from common.config import Config
from common.runtime import serve

if __name__ == "__main__":
    asyncio.run(
        serve(BookingAgent(Config.from_env(), warmup=os.getenv("DOMAIN_MODEL_WARMUP", "true").lower() == "true"))
    )
