# Hub agent

This package owns self-answering, strict empty-argument Billing/Booking tool
selection, speculative session acquisition, raw-input forwarding, session reuse,
and exact-owned-session cleanup. `agent.py` contains `HubAgent`; `config.py`
contains pinned Domain references; `prompts.py` contains only Hub instructions
and tool descriptions. Shared lifecycle/SSE/client code comes from `common/`.

From the parent `samples/hub-domain-agent` directory, build with
`docker build -f hub/Dockerfile -t hub-agent:local .`. The image starts
`python -m hub.main` and contains no Billing or Booking implementation.

Set `HUB_AGENT_IMAGE` to its published runtime digest. The deployment script
injects the two Domain names/versions. Hub model warmup remains off.
Follow the parent [README](../README.md) and [test procedure](../TESTING.md).
