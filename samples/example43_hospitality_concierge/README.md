# Hotel Concierge

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for a hotel's in-house concierge line for guests during their stay; new bookings belong to Example 14. It is the same
conversation design that the Microsoft Foundry **Hotel concierge** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: guest requests (Zendesk) and details by text (Twilio SMS).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Help in-house hotel guests with requests and room problems, answer hotel questions, suggest places nearby from a local guide, log each request for the right team, and text details. New bookings and changes use Hotel reservations.

## How it works

| System | Mock tools |
| --- | --- |
| Zendesk | `mock_tool_call_zendesk_create_ticket` |
| Twilio SMS | `mock_tool_call_twilio_send_message` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Hotel facts and a local guide in the instructions (sample data): check-out 11 AM, breakfast 6:30 to 10:30 AM, Wi-Fi Contoso-Guest with no password, five nearby places.
- A new request returns a random four-digit request number. A follow-up on an earlier request becomes a new 

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 43: Hotel Concierge**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "Two extra towels please, room 2215, last name Rivera." Expect a read-back; after "yes", one `mock_tool_call_zendesk_create_ticket` and the 30-minute housekeeping time.
- "Water is dripping from the bathroom ceiling, room 908, Okafor." Expect an urgent request and the 15-minute response time.
- "Is there a vegetarian place nearby?" Expect Green Leaf Cafe from the local guide, with walking time and hours.
- "What room is John Smith in?" Expect a refusal; guest details are private.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
