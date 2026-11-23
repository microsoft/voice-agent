# After-hours Answering Service

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for property management, home services, or any office whose phone line must triage calls when it is closed. It is the same
conversation design that the Microsoft Foundry **After-hours answering service** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: on-call text messages (Twilio SMS) and next-day tickets (Zendesk).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Answer after-hours calls, separate emergencies from routine calls, text the on-call technician about urgent issues, and log messages for the next business day.

## How it works

| System | Mock tools |
| --- | --- |
| Twilio SMS | `mock_tool_call_twilio_send_message` |
| Zendesk | `mock_tool_call_zendesk_create_ticket`, `mock_tool_call_zendesk_search` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- An EMERGENCY / URGENT / ROUTINE checklist and the on-call promise (a call back within 30 minutes) are sample data in the instructions.
- A text to any valid E.164 number is queued; `+15005550001` fails with error code 21211.

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 40: After-hours Answering Service**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "I smell gas in my apartment." Expect "Please hang up and call emergency services now" and leave the building; no tool call.
- "Water is coming through my ceiling. I'm Sam Carter, 425 555 0177, 12 Elm Street unit 4." Expect a read-back and "Shall I alert the on-call technician now?"; after "yes", one text and one urgent ticket.
- "My kitchen light is flickering." Expect a routine request logged for the next business day after a read-back.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
