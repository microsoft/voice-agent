# General Receptionist

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for a small business front desk: clinics, law and accounting firms, property managers, or any office that answers common questions and takes messages. It is the same
conversation design that the Microsoft Foundry **General receptionist** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: help center search and callback tickets (Zendesk) and department email (Microsoft 365 mail).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Answer front desk questions from business facts and help-center articles, email a message to the right department, and file a callback request. The department email addresses are samples; replace them in the instructions before you connect a real mail system.

## How it works

| System | Mock tools |
| --- | --- |
| Zendesk | `mock_tool_call_zendesk_search`, `mock_tool_call_zendesk_create_ticket` |
| Microsoft 365 Mail | `mock_tool_call_send_email_with_attachments` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Business facts in the instructions (sample data): open Monday to Friday 8 AM to 6 PM and Saturday 9 AM to 1 PM, 100 Main Street, Suite 200, free parking behind the building; departments Front office, Billing, Scheduling, and Office manager.
- Help-center articles match keywords such as password, MFA, VPN, or Wi-Fi (mock Zendesk articles).

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 39: General Receptionist**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "Are you open on Sundays?" Expect it is closed on Sundays, from the business facts, with no tool call.
- "How do I reset my password?" Expect `mock_tool_call_zendesk_search` and an answer that names the article.
- "Leave a message for billing: I'm Dana Test, 425 555 0123, I was charged twice." Expect a read-back with the number digit by digit; after "yes", one `mock_tool_call_send_email_with_attachments`.
- "Transfer me to Megan in HR." Expect this line cannot transfer calls, and an offer to take a message.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
