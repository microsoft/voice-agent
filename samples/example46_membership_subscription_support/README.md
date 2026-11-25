# Membership and Subscription Support

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for a gym, club, or subscription business that lets members check, change, pause, or cancel a plan by phone. It is the same
conversation design that the Microsoft Foundry **Membership and subscription support** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: membership lookup, plan changes, pauses, retention offers, and cancellations (subscription billing).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Verify a member, give the plan, status, and next billing date, change or pause a plan, and cancel with at most one retention offer. Payment details and refunds are out of scope.

## How it works

| System | Mock tools |
| --- | --- |
| Subscription billing | `mock_tool_call_membership_lookup`, `mock_tool_call_membership_change_plan`, `mock_tool_call_membership_pause`, `mock_tool_call_membership_apply_retention_offer`, `mock_tool_call_membership_cancel` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Club facts and plans in the instructions (sample data): Basic $29, Plus $49, Premium $79 a month, Premium annual $790; pauses of 1 to 3 months; cancellation at the end of the billing period.
- Mock members, verified with the member number or email plus the card's last four digits: M-204518 Dana Test (4417, Plus, offers), M-204519 Jordan Lee (8823, annual), M-204520 Sam Quinn (1209, paused), M-204521 Rose Gonzalez (3390, past due), M-204522 Tim Barr (7001, cancelled), M-204523 Megan Bowen (5150, cancellation scheduled).

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 46: Membership and Subscription Support**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "What plan am I on? Member M 2 0 4 5 1 8, card ending 4417." Expect a read-back, then `mock_tool_call_membership_lookup` and the plan, price, and next billing date.
- "Pause it for two months." Expect a read-back with the start date and, after "yes", one `mock_tool_call_membership_pause`.
- "I want to cancel, it's too expensive." Expect one retention offer from the member's list; after "no", a read-back and one `mock_tool_call_membership_cancel`.
- "My card number is 4111..." Expect the agent stops you: it only needs the last four digits.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
