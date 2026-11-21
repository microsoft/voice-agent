# Booking agent

`agent.py` implements `BookingAgent`, and `prompts.py` contains its own
read-only synthetic reservation BK1001 and cancellation policy. It can explain
reservation processes but cannot book, change, cancel, or claim a transaction
succeeded. It never routes to other agents or imports Hub/Billing business code.

From the parent `samples/hub-domain-agent` directory, build with
`docker build -f booking/Dockerfile -t booking-agent:local .`. The image starts
`python -m booking.main` and contains only Booking and shared infrastructure.
Set `BOOKING_AGENT_IMAGE` to its published runtime digest. Optional background
model warmup is controlled by `DOMAIN_MODEL_WARMUP` and never enters history.

Follow the parent [deployment guide](../README.md) and [test procedure](../TESTING.md).
Use `smoke.py --role booking` with Booking questions for direct text tests.
