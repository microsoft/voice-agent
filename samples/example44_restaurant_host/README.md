# Restaurant Host

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for a restaurant's phone line for table reservations and menu questions; phone food orders belong to Example 29. It is the same
conversation design that the Microsoft Foundry **Restaurant host** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: table availability, booking, lookup, and cancellation (reservation system) and confirmations by text (Twilio SMS).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Book, look up, change, and cancel restaurant table reservations, answer menu, allergen, hours, and policy questions from restaurant facts, and text the confirmation. Phone food orders use Restaurant phone order taker.

## How it works

| System | Mock tools |
| --- | --- |
| Reservation system | `mock_tool_call_restaurant_check_availability`, `mock_tool_call_restaurant_create_reservation`, `mock_tool_call_restaurant_get_reservation`, `mock_tool_call_restaurant_cancel_reservation` |
| Twilio SMS | `mock_tool_call_twilio_send_message` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Restaurant facts and menu highlights with allergens in the instructions (sample data); closed Mondays.
- Mock reservations: seatings every 30 minutes; Friday 7:00 and 7:30 PM and Saturday 6:30 to 8:00 PM are full; parties over 8 go to the events team. Existing reservations TR4K7Q (Test) and TR9X2M (Lee).

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 44: Restaurant Host**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "A table for two this Thursday at 7:30 PM." Expect `mock_tool_call_restaurant_check_availability`, then name and mobile, one read-back, and after "yes" one booking.
- "Table for 4 this Friday at 7 PM." Expect that time is full and at most two nearby open times.
- "Does the carbonara have nuts?" Expect the listed allergens and that the kitchen cannot guarantee any dish is free of traces.
- "Cancel reservation T R 9 X 2 M, last name Lee." Expect a lookup, a read-back, and after "yes" one cancellation.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
