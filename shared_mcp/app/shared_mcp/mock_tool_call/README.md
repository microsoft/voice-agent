# `mock-tool-call` pack

Mock business tools for the Voice Agent Template catalog. Each Template card can run
on these tools (the default in the Playground) or on a real MCP server. The mocks
take the same arguments as the real tools and return the same fields, plus
`mock: true` and `tool`, so a Template's stage instructions work unchanged on either.
Nothing real is booked, sent, or charged.

Route: `/mcp/mock-tool-call` on the public no-auth MCP service that the default Portal
Templates use (see [`portal/templates.config.json`](../../../../portal/templates.config.json)).
Every tool name starts with `mock_tool_call_`.

## Result shape

Business tools return the real tool's fields with `ok` and `error`:

```json
{"mock": true, "tool": "mock_tool_call_zendesk_create_ticket", "ok": true,
 "source": "zendesk", "ticket_id": 1001, "status": "new", "priority": "high", "error": null}
```

A business failure (unknown ticket, invalid phone, sold-out room) is a normal result
with `ok: false` and `error: {"code", "message"}`; the MCP result is not `isError`.
Invalid arguments (missing required field, wrong enum, text too long) are rejected by
schema validation as MCP errors.

`mock_tool_call_echo` is the protocol self-test. It follows the shared MCP contract:
`request_id` (1-128 characters, not blank), `text` (up to 4096), `mode` (`success` or
`business_error`), and returns `{mock, tool, request_id, status, data, error}` with
`status` `succeeded` or `failed`. It is stateless and deterministic.

## Tools

| Mock tool | Mirrors | Notes |
| --- | --- | --- |
| `mock_tool_call_find_meeting_times` | Work IQ `FindMeetingTimes` | Suggestions in UTC with `end` listed before `start`, like the real tool. Same arguments (`meetingDuration`, `startDateTime`, `endDateTime`, `timeZone`, `attendeeEmails`, `maxCandidates`, `returnSuggestionReasons`). |
| `mock_tool_call_get_user_date_and_time_zone_settings` | Work IQ `GetUserDateAndTimeZoneSettings` | Today's date and time in Pacific Standard Time. |
| `mock_tool_call_create_event` | Work IQ `CreateEvent` | Returns `id`, times, attendees, and a fake Teams `joinUrl` for online meetings. |
| `mock_tool_call_list_calendar_view` | Work IQ `ListCalendarView` | Events overlapping the range whose subject contains `subject`. |
| `mock_tool_call_update_event` | Work IQ `UpdateEvent` | Moves or renames an event. |
| `mock_tool_call_cancel_event` | Work IQ `CancelEvent` | Returns `cancelled`; nothing is stored, so the event still lists for the next caller. |
| `mock_tool_call_get_user_presence` | Work IQ Teams `GetUserPresence` | Argument `userEmail`. |
| `mock_tool_call_send_email_with_attachments` | Work IQ Mail `SendEmailWithAttachments` | Reports `sent`; no email leaves the service. |
| `mock_tool_call_salesforce_search` | `salesforce_search` | Contacts by exact email or partial name. |
| `mock_tool_call_salesforce_get_contact` | `salesforce_get_contact` | By Contact Id or email; `found`. |
| `mock_tool_call_salesforce_create_lead` | `salesforce_create_lead` | Returns `lead_id` `00QMOCK…`. |
| `mock_tool_call_zendesk_search` | `zendesk_search` | `type=articles` (default) searches the articles below; `type=tickets` searches tickets, a number reads one ticket. |
| `mock_tool_call_zendesk_add_comment` | `zendesk_add_comment` | Tickets 1 to 3, or a four-digit number from `zendesk_create_ticket`; reports the ticket reopened. |
| `mock_tool_call_zendesk_create_ticket` | `zendesk_create_ticket` | Returns a random four-digit ticket number; the ticket is not stored. |
| `mock_tool_call_twilio_send_message` | `twilio_send_message` | Any valid E.164 number is `queued`; no text is delivered. |
| `mock_tool_call_order_lookup` | Order lookup (custom tool) | By order number or account email. With both, the email must match the order (`VERIFICATION_FAILED` otherwise), so no detail is returned to an unverified caller. An email shared by several orders returns `MULTIPLE_ORDERS` instead of picking one. |
| `mock_tool_call_product_search` | Store catalog search (custom tool) | Keywords, category, `max_price`, `in_stock_only`, or an exact product ID; `total_matches` larger than `count` means more matches. |
| `mock_tool_call_cart_add_item` | Store cart (custom tool) | Checks product, stock, and size and returns the cart line; the cart is not stored. |
| `mock_tool_call_hotel_check_availability` | Hotel reservation tools (custom) | Rooms, availability, and total before taxes. |
| `mock_tool_call_hotel_create_reservation` | | Returns a random confirmation number such as `M3K9QZ`; the reservation is not stored. |
| `mock_tool_call_hotel_get_reservation` | | By confirmation number and last name. |
| `mock_tool_call_hotel_cancel_reservation` | | Reports a one-night `cancellation_fee` inside 48 hours of the 3 PM arrival. |
| `mock_tool_call_restaurant_check_availability` | Restaurant reservation system (custom tool) | Date, time, and party size; returns whether the time is free, up to four nearby open times, and the first and last seating. `LARGE_PARTY` above 8 guests, `CLOSED` on Mondays. Every result, including failures, carries `today` and `today_weekday`, so an Agent can turn "this Friday" into a date. |
| `mock_tool_call_restaurant_create_reservation` | | Guest name, E.164 phone, date, time, party size, optional seating, occasion, and special requests; returns a random confirmation number such as `R4K9QZ`; not stored. |
| `mock_tool_call_restaurant_get_reservation` | | By confirmation number and last name; returns the date, time, party, seating, guest name and phone, and requests. |
| `mock_tool_call_restaurant_cancel_reservation` | | By confirmation number and last name; returns `cancelled`. |
| `mock_tool_call_membership_lookup` | Subscription billing (custom tool) | By member number or account email, verified with the card's last four digits (`NOT_FOUND` / `VERIFICATION_FAILED`, never says which part failed). Returns plan, price, status, next billing date, current period end, pause options, and the member's eligible retention offers. |
| `mock_tool_call_membership_change_plan` | | From the next billing date. `SAME_PLAN`, `PLAN_NOT_AVAILABLE` (annual plans change only at renewal), `PAST_DUE`, `NOT_ACTIVE`. |
| `mock_tool_call_membership_pause` | | 1 to 3 months from the next billing date. `ALREADY_PAUSED`, `PAUSE_NOT_ELIGIBLE` (annual plan or a pause in the last 12 months), `PAST_DUE`, `NOT_ACTIVE`. |
| `mock_tool_call_membership_apply_retention_offer` | | Only an `offer_id` that the lookup listed for this member (`OFFER_NOT_ELIGIBLE` otherwise). |
| `mock_tool_call_membership_cancel` | | At the end of the current period; returns `effective_date` and `access_until`. `ALREADY_CANCELLED`, `PENDING_CANCEL` (with its date). |
| `mock_tool_call_shipment_track` | Carrier tracking (custom tool) | Status, detail, last scan, estimated date and window. With the matching delivery postal code (`POSTAL_CODE_MISMATCH` otherwise) it adds where a delivered parcel was left and whether a trace can be opened (24 hours after delivery), redelivery dates, pickup points, and the hold end date. |
| `mock_tool_call_shipment_schedule_redelivery` | | After a missed attempt only (`NOT_ELIGIBLE` with `reason`); one of the next 5 delivery days, Monday to Saturday (`DATE_UNAVAILABLE` with `available_dates`). |
| `mock_tool_call_shipment_update_delivery` | | `add_instructions`, `hold_at_pickup_point`, or `correct_unit`. `NOT_ALLOWED_BY_SENDER`, `ALREADY_DELIVERED`, `TOO_LATE` (out for delivery: instructions only), `PICKUP_POINT_NOT_FOUND`. |
| `mock_tool_call_pharmacy_rx_lookup` | Pharmacy system (custom tool) | Rx number, last name, and date of birth must all match (`NOT_FOUND` / `VERIFICATION_FAILED`) before any detail. Returns the medication, refills, earliest refill date, `can_refill_now` with the blocking reason, the prescriber, and any refill in progress. |
| `mock_tool_call_pharmacy_refill_submit` | | Returns `refill_id` and `ready_by`. `NO_REFILLS_LEFT`, `TOO_SOON`, `CONTROLLED_SUBSTANCE`, `PRESCRIPTION_EXPIRED`, `TRANSFERRED_OUT`, `ALREADY_IN_PROGRESS`. |
| `mock_tool_call_pharmacy_renewal_request` | | Sends a renewal request to the prescriber. `RENEWAL_ALREADY_PENDING`, `REFILLS_REMAIN`, `TRANSFERRED_OUT`. |
| `mock_tool_call_quiz_record_result` | | Records a quiz score; returns `record_id` and `passed`. |
| `mock_tool_call_training_record_session` | | Records a role-play debrief with four 1-5 scores. |
| `mock_tool_call_research_save_interview_notes` | | Saves a recap only when `consent_given` is true. |
| `mock_tool_call_echo` | | Protocol self-test. |

## Fixed test data

All values are in [`fixtures.json`](fixtures.json) and match the Template try-it
guide. The service is stateless: write tools validate their arguments and return
a generated ID, but nothing a caller says is stored or shown to another caller.
Reads return only these fixtures, so a booked slot stays free and a new ticket
or reservation cannot be looked up later.

### CRM contacts

| Name | Email | Phone | Title | Account |
| --- | --- | --- | --- | --- |
| Jack Rogers | `jrogers@burlington.com` | +13362227000 | VP, Facilities | Burlington Textiles Corp of America |
| Jordan Lee | `jordan.lee@example.com` | +14255550123 | Customer | Individual |
| Rose Gonzalez | `rose@edge.com` | +15124575000 | SVP, Procurement | Edge Communications |
| Tim Barr | `barr_tim@grandhotels.com` | +13125963300 | SVP, Administration and Finance | Grand Hotels and Resorts Ltd |

Any other email, such as `dana.test20261020@example.com`, is a new prospect: search
finds nothing and a Lead can be created.

### Help desk

Existing tickets: **1** (solved, sign-in after password change), **2** (pending,
invoice address), **3** (open, API returns 401; Jack Rogers). Use ticket **3** to add
a comment. Articles match keywords such as: password, MFA, locked out; VPN,
GlobalProtect, authentication failed; sync failure; API 401 or token; install
software, Company Portal; monitor flicker; expense report; PTO or time off; Wi-Fi.

### Calendar

The calendar owner's time zone is Pacific Standard Time. Two events exist from the
first calendar call, on the next Thursday and Friday after that day (Pacific):

| Event | When | Use |
| --- | --- | --- |
| Follow-up visit with Dana Test | Thursday 10:00-10:30 AM | Reschedule or cancel by the name "Dana Test" |
| Initial consultation with Jordan Lee | Friday 2:00-3:00 PM | Reschedule or cancel by the name "Jordan Lee" |

Free slots are fixed for a given day and duration: about one half-hour start in five
is busy, and booked events block their time. Every time zone listed in `service.py`
(Windows names such as China Standard Time) or any IANA name works.

### Directory presence

| Person | Email | Presence |
| --- | --- | --- |
| Alex Wilber | `alexw@contoso.com` | Available |
| Megan Bowen | `meganb@contoso.com` | Busy, in a meeting |
| Adele Vance | `adelev@contoso.com` | Away |
| Isaiah Langer | `isaiahl@contoso.com` | Offline |

### Text messages

Every valid E.164 number succeeds, including the sample directory numbers. To see the
failure path, text **+15005550001**: the result is `ok: false` with error code `21211`.
A number without a country code also fails.

### Orders (Contoso Shop)

| Order | Customer | Status | Items |
| --- | --- | --- | --- |
| 10045 | Dana Test | In transit, standard shipping, Contoso Express `CX100450001`, ordered 6 days ago, shipped 5 days ago | Rain jacket, size M; wool socks, 3 pack (final sale) |
| 10046 | Jordan Lee | Processing, express, ordered today | Blender, 1.5 L |
| 10047 | Jack Rogers | Delivered 15 days ago | Desk lamp ×2 |
| 10048 | Rose Gonzalez | Delivered 40 days ago (outside a 30-day return window) | Over-ear headphones |
| 10049 | Tim Barr | Cancelled, ordered 3 days ago | Personal blender |
| 10050 | Sam Quinn | Processing, express, ordered yesterday | Wireless earbuds Pro |
| 10051 | Sam Quinn | Delivered 8 days ago, standard, Contoso Express `CX100510001` | Trail running shoes, size 10 |

Dates are relative to the day of the call; the estimated delivery window is 3-5
business days after shipping for standard and 1-2 for express.

Each customer has one order except Sam Quinn: a lookup by `sam.quinn@example.com` alone
returns `MULTIPLE_ORDERS`, while `dana.test20261020@example.com` alone finds 10045.

### Product catalog (Contoso Shop)

Prices are in USD. Search matches singular and plural words in the name, category, features, and tags.
Words of two letters or fewer and common words are ignored, so a query with nothing else (such as "TV") matches
no product. A category without a query still lists that category, with any filters applied.
Similar names (three wireless earbuds, two rain jackets, three desk lamps) and `total_matches` larger
than `count` let a template test product mix-ups and partial results.

| ID | Product | Category | Price | Stock |
| --- | --- | --- | --- | --- |
| SKU-1001 | Rain jacket | Outerwear | $89 | Sizes S, M, L (XL sold out) |
| SKU-1002 | Insulated winter parka | Outerwear | $189 | Sizes M, L |
| SKU-1003 | Lightweight windbreaker | Outerwear | $49 | Sizes S, M, L |
| SKU-1004 | Wool socks, 3 pack (final sale) | Accessories | $18 | Sizes M, L |
| SKU-1005 | Kids' rain jacket | Outerwear | $59 | Size S only |
| SKU-1101 | Blender, 1.5 L | Kitchen | $79 | In stock |
| SKU-1102 | Personal blender | Kitchen | $39 | In stock |
| SKU-1103 | High-performance blender, 2 L | Kitchen | $199 | **Out of stock** |
| SKU-1201 | LED desk lamp | Home office | $45 | In stock |
| SKU-1202 | Clamp desk lamp | Home office | $29 | In stock |
| SKU-1203 | LED desk lamp with wireless charger | Home office | $69 | In stock |
| SKU-1301 | Wireless earbuds | Audio | $99 | In stock |
| SKU-1302 | Over-ear headphones | Audio | $149 | In stock |
| SKU-1303 | Wireless earbuds Pro | Audio | $179 | In stock |
| SKU-1304 | Wireless earbuds Lite | Audio | $49 | **Out of stock** |
| SKU-1401 | Trail running shoes | Footwear | $119 | Sizes 8 to 11 |

The cart is not stored: `cart_add_item` checks the product, stock, and size and returns the line, but
a later call cannot read the cart. Try `SKU-1103` for `OUT_OF_STOCK` and the rain jacket in XL for
`SIZE_UNAVAILABLE`.

### Hotel (The Grand Hotel)

| Room | Sleeps | Nightly rate | Availability |
| --- | --- | --- | --- |
| Classic King | 2 | $229 | Always |
| Deluxe Double Queen | 4 | $259 | Always |
| Junior Suite | 3 | $349 | Sold out on Saturday nights |

Existing reservation: **A1B2C3**, last name **Test** (Dana Test), Classic King, 2
nights, arriving 14 days after the first lookup. Cancelling it is free; a reservation
whose arrival is within 48 hours reports a one-night fee.

### Restaurant (Contoso Trattoria)

Seatings every 30 minutes, local time (Pacific): Tuesday to Thursday 5:00-9:00 PM, Friday
5:00-10:00 PM, Saturday 12:00-10:00 PM, Sunday 12:00-8:00 PM; closed Mondays. Friday 7:00 and
7:30 PM and Saturday 6:30 to 8:00 PM are fully booked, so a request then returns nearby open
times. Parties up to 8 (patio up to 6, bar up to 2); larger parties return `LARGE_PARTY`.
Bookings open 60 days ahead.

| Confirmation | Last name | When | Party | Seating | Notes |
| --- | --- | --- | --- | --- | --- |
| **TR4K7Q** | Test (Dana) | 3 days after the call, 7:00 PM | 4 | Dining room | Birthday |
| **TR9X2M** | Lee (Jordan) | 10 days after the call, 6:00 PM | 2 | Patio | High chair |

Cancelling returns `cancelled`, but nothing is stored, so the reservation still lists for the next caller.

### Memberships (Contoso Fitness Club)

Plans: Basic $29, Plus $49, Premium $79 a month; Premium annual $790. Dates are relative to the call; the
current period ends the day before the next billing date. Verify with the member number or email plus the
card's last four digits.

| Member | Email | Card last 4 | Plan and state | Try |
| --- | --- | --- | --- | --- |
| **M-204518** Dana Test | `dana.test20261020@example.com` | 4417 | Plus, active, next bill in 9 days | Change, pause 1-3 months, offers `OFFER-DOWN-BASIC` and `OFFER-50OFF-2M`, cancel |
| **M-204519** Jordan Lee | `jordan.lee@example.com` | 8823 | Premium annual, renews in 40 days | Pause `PAUSE_NOT_ELIGIBLE`, change `PLAN_NOT_AVAILABLE`, only `OFFER-DOWN-PLUS-AT-RENEWAL` |
| **M-204520** Sam Quinn | `sam.quinn@example.com` | 1209 | Plus, paused for 20 more days | Pause `ALREADY_PAUSED` |
| **M-204521** Rose Gonzalez | `rose@edge.com` | 3390 | Basic, past due | Change `PAST_DUE` |
| **M-204522** Tim Barr | `barr_tim@grandhotels.com` | 7001 | Cancelled 60 days ago | Cancel `ALREADY_CANCELLED` |
| **M-204523** Megan Bowen | `meganb@contoso.com` | 5150 | Premium, cancellation scheduled in 5 days | Cancel `PENDING_CANCEL` |

### Shipments (Contoso Parcel)

Deliveries Monday to Saturday. Redelivery: the next 5 delivery days, 12:00-6:00 PM. Holds last 5 days.
Times are local (Pacific) and relative to the call.

| Tracking | Postal code | State | Try |
| --- | --- | --- | --- |
| **CP10447201** | 98052 | Out for delivery today, 2:00-6:00 PM | Hold `TOO_LATE`; instructions ok |
| **CP10447202** | 98101 | Delivery attempted yesterday, signature required | Redelivery (Sunday `DATE_UNAVAILABLE`); hold at `PP-1021` Pike Street |
| **CP10447203** | 98004 | Exception: unit number missing | `correct_unit` |
| **CP10447204** | 98052 | Delivered 2 days ago, 1:14 PM, front door, photo | Location only with the postal code; trace eligible |
| **CP10447205** | 98033 | In transit, weather delay, new estimate in 2 days | Status |
| **CP10447206** | 98052 | Label created, not yet handed over by the sender | Status |
| **CP10447207** | 98101 | Held at `PP-1021` for 3 more days | Pickup point and hold date with the postal code |
| **CP10447208** | 98004 | Returned to the sender | Redelivery `NOT_ELIGIBLE` |
| **CP10447209** | 98052 | In transit; the sender doesn't allow changes | Update `NOT_ALLOWED_BY_SENDER` |
| **CP10447210** | 98052 | Delivered 3 hours ago, front porch | Not yet trace eligible |

### Pharmacy (Contoso Pharmacy, 120 Pine Street)

Open Monday to Friday 9 AM-9 PM, Saturday 9 AM-6 PM, Sunday 10 AM-5 PM (Pacific). A refill submitted before
5 PM is ready 4 hours later (rounded up to the half hour) if the store is still open; otherwise the next day
at 11 AM. A refill is due once 75% of the days' supply has passed. Patients: Dana Test (born 1990-02-14),
Jordan Lee (1985-03-14), Sam Quinn (1992-07-30).

| Rx | Patient | Medication | Try |
| --- | --- | --- | --- |
| **6010231** | Dana Test | Atorvastatin 20 mg, 3 refills | Refill ok |
| **6010232** | Dana Test | Lisinopril 10 mg, no refills | `NO_REFILLS_LEFT`, renewal ok (Dr. Avery Rivera) |
| **6010233** | Dana Test | Metformin 500 mg, refill `RF-20417` in progress | `ALREADY_IN_PROGRESS` |
| **6020418** | Jordan Lee | Sertraline 50 mg, filled 10 days ago | `TOO_SOON` (due in 13 days) |
| **6020419** | Jordan Lee | Oxycodone 5 mg, Schedule II | `CONTROLLED_SUBSTANCE`, renewal ok |
| **6030555** | Sam Quinn | Levothyroxine 50 mcg | `TRANSFERRED_OUT` |
| **6030556** | Sam Quinn | Amlodipine 5 mg, expired 60 days ago | `PRESCRIPTION_EXPIRED`, renewal ok |
| **6030557** | Sam Quinn | Omeprazole 20 mg, renewal `RN-30112` pending | Renewal `RENEWAL_ALREADY_PENDING` |

Writes are not stored: a cancelled membership, a redelivery, or a refill does not change a later lookup.
