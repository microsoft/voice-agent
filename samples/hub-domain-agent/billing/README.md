# Billing agent

`agent.py` implements `BillingAgent`, and `prompts.py` contains its own
read-only synthetic bill: base fee 99 yuan plus 15 excess calls at 2 yuan each,
30 yuan extra and 129 yuan total. It never charges, refunds, modifies accounts,
routes to other agents, or imports Hub/Booking business code.

From the parent `samples/hub-domain-agent` directory, build with
`docker build -f billing/Dockerfile -t billing-agent:local .`. The image starts
`python -m billing.main` and contains only Billing and shared infrastructure.
Set `BILLING_AGENT_IMAGE` to its published runtime digest. Optional background
model warmup is controlled by `DOMAIN_MODEL_WARMUP` and never enters history.

Follow the parent [deployment guide](../README.md) and [test procedure](../TESTING.md).
Use `smoke.py --role billing` for direct text tests.
