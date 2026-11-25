# Delivery and Shipment Status

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for a parcel carrier or 3PL support line; store orders, returns, and refunds belong to Example 25. It is the same
conversation design that the Microsoft Foundry **Delivery and shipment status** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: tracking, redelivery, and delivery changes (carrier tracking), traces (Zendesk), and updates by text (Twilio SMS).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Track a parcel by tracking number, give the delivery window, schedule a redelivery, add delivery instructions or hold it at a pickup point, open a trace for a missing parcel, and text updates. Store orders, returns, and refunds use Order status tracking.

## How it works

| System | Mock tools |
| --- | --- |
| Carrier tracking | `mock_tool_call_shipment_track`, `mock_tool_call_shipment_schedule_redelivery`, `mock_tool_call_shipment_update_delivery` |
| Zendesk | `mock_tool_call_zendesk_create_ticket` |
| Twilio SMS | `mock_tool_call_twilio_send_message` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Carrier facts in the instructions (sample data): deliveries Monday to Saturday, one free redelivery or a 5-day pickup hold after a missed attempt, traces 24 hours after a delivered scan.
- Mock parcels CP10447201 to CP10447210, for example CP10447201 (98052, out for delivery 2-6 PM), CP10447202 (98101, missed delivery), CP10447203 (98004, unit missing), CP10447204 (98052, delivered 2 days ago). Where a parcel was left and any change need the delivery postal code.

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 47: Delivery and Shipment Status**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "Where's my parcel? C P 1 0 4 4 7 2 0 1." Expect `mock_tool_call_shipment_track` and the delivery window.
- "I missed a delivery, C P 1 0 4 4 7 2 0 2, postal code 98101." Expect two redelivery dates; after a read-back and "yes", one `mock_tool_call_shipment_schedule_redelivery`.
- "It says delivered but I never got it. C P 1 0 4 4 7 2 0 4." Expect a request for the postal code before any location detail, then a trace ticket after a read-back.
- "Send it to my office instead." Expect only the sender can change the address.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
