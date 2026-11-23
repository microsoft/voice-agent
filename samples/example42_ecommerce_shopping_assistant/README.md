# E-commerce Shopping Assistant

## Conclusion

`agent.json` is a single Voice Agent, without a handoff graph, for an online store's voice line or web widget for product questions, order status, and returns. It is the same
conversation design that the Microsoft Foundry **E-commerce shopping assistant** template creates: one prompt, the
business tools at the top level, and `end_conversation`.

By default its tools run on the shared **mock-tool-call** MCP server with fictional data: product search (product catalog), verified order lookup (order system), and return tickets (Zendesk).
Nothing real is booked or sent. To use real systems, choose **Connect real tools** in the Portal Editor or a
Foundry Toolbox in your own Project; see [Connect real tools](../../docs/05_connect_real_tools.md).

## When to use this example

Recommend and compare products from the store catalog, check verified order status and tracking, and start a return on a support ticket.

## How it works

| System | Mock tools |
| --- | --- |
| Product catalog | `mock_tool_call_product_search` |
| Order system | `mock_tool_call_order_lookup` |
| Zendesk | `mock_tool_call_zendesk_create_ticket` |

Every write (ticket, message, text, booking, or cancellation) runs once, only after the caller says yes to a
read-back. The agent says a short goodbye before `end_conversation`, and declining an offer is not a goodbye.

## Sample data

- Catalog: 16 Contoso Shop products with similar names (three wireless earbuds, two rain jackets), out-of-stock items, and sizes in stock.
- Orders: 10045 (Dana Test, `dana.test20261020@example.com`, in transit) and 10046 (Jordan Lee, `jordan.lee@example.com`, processing). Order lookup needs the number and the email on the order.

Fixed mock data is listed in the [mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 42: E-commerce Shopping Assistant**.
4. Choose **Try it now**, then connect in AgentRuntime.

## Try these turns

- "I need a rain jacket under 100 dollars." Expect `mock_tool_call_product_search` and at most two products with price and sizes in stock.
- "Where is order 10045? My email is dana.test20261020@example.com." Expect the number and email read back; after "yes", `mock_tool_call_order_lookup` with both and the status.
- "Can I return the wool socks?" Expect they are final sale and cannot be returned.

## Boundaries

- The business, people, and records are fictional; no ticket, message, text, or booking is real.
- `store` is `false`; enable persistence deliberately if you need it.
- Conversational confirmation is not an authorization boundary; connect real systems as described in
  [Connect real tools](../../docs/05_connect_real_tools.md).
