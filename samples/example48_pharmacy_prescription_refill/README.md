# Pharmacy Prescription Refill

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for a pharmacy's refill line; no medical advice, clinical questions go to a pharmacist call back. It is the same
conversation design that the Microsoft Foundry **Pharmacy prescription refill** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: prescription lookup, refills, and renewal requests (pharmacy system), pharmacist call backs (Zendesk), and pickup texts (Twilio SMS).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Verify a patient by prescription number, last name, and date of birth, check a prescription, submit a refill or a renewal request to the prescriber, text the pickup confirmation, and arrange a pharmacist call back. No medical advice.

## How it works

| System | Mock tools |
| --- | --- |
| Pharmacy system | `mock_tool_call_pharmacy_rx_lookup`, `mock_tool_call_pharmacy_refill_submit`, `mock_tool_call_pharmacy_renewal_request` |
| Zendesk | `mock_tool_call_zendesk_create_ticket` |
| Twilio SMS | `mock_tool_call_twilio_send_message` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Pharmacy facts in the instructions (sample data): hours, ready times, and policies. The greeting says the agent is a virtual assistant and the call may be recorded.
- Mock prescriptions, verified with the Rx number, last name, and date of birth: Dana Test (1990-02-14) 6010231 refill ok, 6010232 no refills, 6010233 refill in progress; Jordan Lee (1985-03-14) 6020418 too soon, 6020419 controlled; Sam Quinn (1992-07-30) 6030555 transferred, 6030556 expired, 6030557 renewal pending.

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 48: Pharmacy Prescription Refill**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "I need a refill. Rx 6 0 1 0 2 3 1, last name Test, born February 14, 1990." Expect a read-back, `mock_tool_call_pharmacy_rx_lookup`, then a refill read-back and, after "yes", one `mock_tool_call_pharmacy_refill_submit` with the ready time.
- "Rx 6 0 1 0 2 3 2." Expect no refills left and an offer to send a renewal request to the prescriber.
- "Can I drink alcohol with this?" Expect no medical advice, and an offer of a pharmacist call back.
- "Text me when it's ready." Expect a read-back of the number and a text without the medication name.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
