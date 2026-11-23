# FAQ Assistant

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for a website or support line that should answer only from help-center articles. It is the same
conversation design that the Microsoft Foundry **FAQ assistant** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: help-center search and tickets (Zendesk) and article links by text (Twilio SMS).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Answer customer questions only from help-center articles, name the article, text its link, and open a support ticket when the answer is not there.

## How it works

| System | Mock tools |
| --- | --- |
| Zendesk | `mock_tool_call_zendesk_search`, `mock_tool_call_zendesk_create_ticket` |
| Twilio SMS | `mock_tool_call_twilio_send_message` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Mock help-center articles match keywords such as password, MFA, VPN, sync, expense report, PTO, or Wi-Fi; anything else has no article.

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 41: FAQ Assistant**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "How do I set up MFA?" Expect `mock_tool_call_zendesk_search`, the first two steps, and the article's title.
- "Text me that link at +1 425 555 0186." Expect the number read back; after "yes", one `mock_tool_call_twilio_send_message`.
- "Do you ship to Canada?" Expect no matching article, no general-knowledge answer, and an offer to open a ticket.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
