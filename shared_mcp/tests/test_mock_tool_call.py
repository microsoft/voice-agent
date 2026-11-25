from __future__ import annotations

import asyncio
import copy
import json
import random
import re
import socket
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
if APP.is_dir() and str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from mcp.server.fastmcp import FastMCP  # noqa: E402
from mcp.server.fastmcp.exceptions import ToolError  # noqa: E402

from shared_mcp.mock_tool_call import pack  # noqa: E402
from shared_mcp.mock_tool_call.server import register_tools  # noqa: E402
from shared_mcp.mock_tool_call.service import MockToolCallService  # noqa: E402

# Tuesday 2026-10-20 10:00 Pacific.
NOW = datetime(2026, 10, 20, 17, 0, tzinfo=timezone.utc)


def build(service: MockToolCallService | None = None) -> FastMCP:
    mcp = FastMCP("mock-tool-call")
    register_tools(mcp, service or MockToolCallService(clock=lambda: NOW, rng=random.Random(7)))
    return mcp


def call(mcp: FastMCP, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    result = asyncio.run(mcp.call_tool(name, arguments))
    if isinstance(result, tuple):
        content, structured = result
        if structured is not None:
            text = json.loads(content[0].text)
            assert text == structured, (text, structured)
            return structured
        return json.loads(content[0].text)
    if isinstance(result, dict):
        return result
    return json.loads(result[0].text)


def tools(mcp: FastMCP) -> dict[str, Any]:
    return {tool.name: tool for tool in asyncio.run(mcp.list_tools())}


class EchoContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def test_inventory_uses_the_pack_prefix(self) -> None:
        names = set(tools(self.mcp))
        self.assertIn("mock_tool_call_echo", names)
        self.assertTrue(all(name.startswith("mock_tool_call_") for name in names))

    def test_echo_input_and_output_schema(self) -> None:
        echo = tools(self.mcp)["mock_tool_call_echo"]
        schema = echo.inputSchema
        self.assertEqual(set(schema["required"]), {"request_id", "text"})
        self.assertEqual(schema["properties"]["request_id"]["minLength"], 1)
        self.assertEqual(schema["properties"]["request_id"]["maxLength"], 128)
        self.assertEqual(schema["properties"]["text"]["maxLength"], 4096)
        self.assertEqual(schema["properties"]["mode"]["enum"], ["success", "business_error"])
        self.assertEqual(schema["properties"]["mode"]["default"], "success")
        output = echo.outputSchema
        self.assertIsNotNone(output)
        self.assertEqual(
            set(output["required"]),
            {"mock", "tool", "request_id", "status", "data", "error"},
        )

    def test_success_and_business_error_shapes(self) -> None:
        arguments = {"request_id": "mock-demo-001", "text": "hello shared mcp", "mode": "success"}
        self.assertEqual(
            call(self.mcp, "mock_tool_call_echo", arguments),
            {
                "mock": True,
                "tool": "mock_tool_call_echo",
                "request_id": "mock-demo-001",
                "status": "succeeded",
                "data": {"text": "hello shared mcp"},
                "error": None,
            },
        )
        self.assertEqual(
            call(self.mcp, "mock_tool_call_echo", {**arguments, "mode": "business_error"}),
            {
                "mock": True,
                "tool": "mock_tool_call_echo",
                "request_id": "mock-demo-001",
                "status": "failed",
                "data": None,
                "error": {
                    "code": "MOCK_BUSINESS_ERROR",
                    "message": "Synthetic business failure requested by the caller.",
                },
            },
        )

    def test_invalid_input_is_rejected(self) -> None:
        invalid = [
            {"text": "x"},
            {"request_id": "a", "text": "x", "mode": "other"},
            {"request_id": "   ", "text": "x"},
            {"request_id": "a" * 129, "text": "x"},
            {"request_id": "a", "text": "x" * 4097},
        ]
        for arguments in invalid:
            with self.subTest(arguments=list(arguments)):
                with self.assertRaises(ToolError):
                    call(self.mcp, "mock_tool_call_echo", arguments)

    def test_echo_is_deterministic_across_instances(self) -> None:
        arguments = {"request_id": "r-1", "text": "same"}
        first = call(self.mcp, "mock_tool_call_echo", arguments)
        self.assertEqual(first, call(self.mcp, "mock_tool_call_echo", arguments))
        self.assertEqual(first, call(build(), "mock_tool_call_echo", arguments))

    def test_registration_needs_no_network_or_state_store(self) -> None:
        # The hosted service still sets the shared-state flag for other packs; this pack ignores it.
        with patch.object(socket, "create_connection", side_effect=AssertionError("network")), patch.dict(
            "os.environ", {"NOAUTH_MCP_REQUIRE_SHARED_STATE": "true"}, clear=True,
        ):
            mcp = FastMCP("mock-tool-call")
            pack.register(mcp)
            self.assertIn("mock_tool_call_echo", tools(mcp))
            call(mcp, "mock_tool_call_echo", {"request_id": "n", "text": "t"})


class BusinessToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def test_every_business_result_is_marked_mock(self) -> None:
        result = call(self.mcp, "mock_tool_call_salesforce_search", {"email": "jrogers@burlington.com"})
        self.assertTrue(result["mock"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["records"][0]["Name"], "Jack Rogers")
        self.assertEqual(result["records"][0]["Account"]["Name"], "Burlington Textiles Corp of America")

    def test_calendar_find_book_list_update_cancel(self) -> None:
        found = call(self.mcp, "mock_tool_call_find_meeting_times", {
            "meetingDuration": "PT30M",
            "startDateTime": "2026-10-22T09:00:00",
            "endDateTime": "2026-10-22T17:00:00",
            "timeZone": "Pacific Standard Time",
            "maxCandidates": 3,
        })
        slots = found["meetingTimeSuggestions"]
        self.assertEqual(len(slots), 3)
        self.assertEqual(list(slots[0]["meetingTimeSlot"]), ["end", "start"])
        self.assertEqual(slots[0]["meetingTimeSlot"]["start"]["timeZone"], "UTC")
        created = call(self.mcp, "mock_tool_call_create_event", {
            "subject": "Initial consultation with Dana Test",
            "startDateTime": "2026-10-22T09:00:00",
            "endDateTime": "2026-10-22T10:00:00",
            "timeZone": "Pacific Standard Time",
            "attendeeEmails": ["dana.test20261020@example.com"],
            "isOnlineMeeting": True,
        })
        self.assertTrue(created["ok"])
        self.assertRegex(created["id"], r"^mock-evt-[0-9a-f]{8}$")
        self.assertIn("joinUrl", created["onlineMeeting"])
        # Nothing is stored, so the booked slot stays free and listings show only the seeds.
        again = call(self.mcp, "mock_tool_call_find_meeting_times", {
            "meetingDuration": "PT30M",
            "startDateTime": "2026-10-22T09:00:00",
            "endDateTime": "2026-10-22T10:00:00",
            "timeZone": "Pacific Standard Time",
        })
        self.assertTrue(again["meetingTimeSuggestions"])
        listed = call(self.mcp, "mock_tool_call_list_calendar_view", {
            "startDateTime": "2026-10-22T00:00:00",
            "endDateTime": "2026-10-22T23:59:00",
            "timeZone": "Pacific Standard Time",
            "subject": "Dana Test",
        })
        self.assertEqual([event["id"] for event in listed["value"]], ["mock-evt-seed-1"])
        moved = call(self.mcp, "mock_tool_call_update_event", {
            "eventId": created["id"],
            "startDateTime": "2026-10-23T11:00:00",
            "endDateTime": "2026-10-23T12:00:00",
            "timeZone": "Pacific Standard Time",
        })
        self.assertEqual(moved["start"]["dateTime"], "2026-10-23T11:00:00.0000000")
        partial = call(self.mcp, "mock_tool_call_update_event", {"eventId": created["id"], "subject": "Renamed"})
        self.assertEqual(partial["error"]["code"], "INVALID_ARGUMENT")
        reseeded = call(self.mcp, "mock_tool_call_update_event", {
            "eventId": "mock-evt-seed-2",
            "startDateTime": "2026-10-23T15:00:00",
            "endDateTime": "2026-10-23T16:00:00",
            "timeZone": "Pacific Standard Time",
        })
        self.assertEqual(reseeded["subject"], "Initial consultation with Jordan Lee")
        cancelled = call(self.mcp, "mock_tool_call_cancel_event", {"eventId": "mock-evt-seed-1"})
        self.assertTrue(cancelled["cancelled"])
        # The seed is not left cancelled for the next caller.
        twice = call(self.mcp, "mock_tool_call_cancel_event", {"eventId": "mock-evt-seed-1"})
        self.assertTrue(twice["ok"])
        created_cancel = call(self.mcp, "mock_tool_call_cancel_event", {"eventId": created["id"]})
        self.assertTrue(created_cancel["cancelled"])
        unknown = call(self.mcp, "mock_tool_call_cancel_event", {"eventId": "evt-made-up"})
        self.assertEqual(unknown["error"]["code"], "EVENT_NOT_FOUND")

    def test_seed_event_is_next_thursday(self) -> None:
        listed = call(self.mcp, "mock_tool_call_list_calendar_view", {
            "startDateTime": "2026-10-22T00:00:00",
            "endDateTime": "2026-10-22T23:59:00",
            "timeZone": "Pacific Standard Time",
            "subject": "dana test",
        })
        self.assertEqual(listed["value"][0]["start"]["dateTime"], "2026-10-22T10:00:00.0000000")
        self.assertEqual(listed["value"][0]["dayOfWeek"], "Thursday")

    def test_unknown_time_zone_is_a_business_failure(self) -> None:
        result = call(self.mcp, "mock_tool_call_find_meeting_times", {
            "meetingDuration": "PT30M",
            "startDateTime": "2026-10-22T09:00:00",
            "endDateTime": "2026-10-22T17:00:00",
            "timeZone": "Mars Standard Time",
        })
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "UNKNOWN_TIME_ZONE")

    def test_zendesk_search_comment_and_create(self) -> None:
        found = call(self.mcp, "mock_tool_call_zendesk_search", {"query": "VPN says authentication failed"})
        self.assertEqual(found["results"][0]["id"], 360002)
        commented = call(self.mcp, "mock_tool_call_zendesk_add_comment", {"ticket_id": "3", "comment": "Still 401"})
        self.assertEqual((commented["ticket_id"], commented["status"]), (3, "open"))
        missing = call(self.mcp, "mock_tool_call_zendesk_add_comment", {"ticket_id": "999", "comment": "x"})
        self.assertEqual(missing["error"]["code"], "TICKET_NOT_FOUND")
        created = call(self.mcp, "mock_tool_call_zendesk_create_ticket", {
            "subject": "Escalation", "description": "Nothing worked", "priority": "high",
        })
        self.assertEqual((created["status"], created["priority"]), ("new", "high"))
        self.assertTrue(1000 <= created["ticket_id"] <= 9999)
        follow_up = call(self.mcp, "mock_tool_call_zendesk_add_comment", {
            "ticket_id": str(created["ticket_id"]), "comment": "More detail",
        })
        self.assertEqual((follow_up["ticket_id"], follow_up["status"]), (created["ticket_id"], "open"))
        lookup = call(self.mcp, "mock_tool_call_zendesk_search", {
            "query": str(created["ticket_id"]), "type": "tickets",
        })
        self.assertEqual(lookup["count"], 0)
        fixture = call(self.mcp, "mock_tool_call_zendesk_search", {"query": "401 unauthorized", "type": "tickets"})
        self.assertEqual([result["id"] for result in fixture["results"]], [3])

    def test_sms_success_and_failure(self) -> None:
        sent = call(self.mcp, "mock_tool_call_twilio_send_message", {"to": "+1 978 627 7446", "body": "Hi"})
        self.assertEqual(sent["status"], "queued")
        self.assertTrue(sent["message_sid"].startswith("SMMOCK"))
        failed = call(self.mcp, "mock_tool_call_twilio_send_message", {"to": "+15005550001", "body": "Hi"})
        self.assertFalse(failed["ok"])
        self.assertEqual(failed["error"]["code"], "21211")
        with self.assertRaises(ToolError):
            call(self.mcp, "mock_tool_call_twilio_send_message", {"to": "+19786277446", "body": "x" * 301})

    def test_lead_presence_mail_and_order(self) -> None:
        lead = call(self.mcp, "mock_tool_call_salesforce_create_lead", {"last_name": "Test", "company": "Fabrikam"})
        self.assertRegex(lead["lead_id"], r"^00QMOCK\d{9}$")
        presence = call(self.mcp, "mock_tool_call_get_user_presence", {"userEmail": "meganb@contoso.com"})
        self.assertEqual(presence["availability"], "Busy")
        mail = call(self.mcp, "mock_tool_call_send_email_with_attachments", {
            "to": "meganb@contoso.com", "subject": "Phone message from Dana", "body": "Call back",
        })
        self.assertEqual(mail["status"], "sent")
        order = call(self.mcp, "mock_tool_call_order_lookup", {"order_number": "10045"})
        self.assertEqual(order["order"]["status"], "in_transit")
        self.assertEqual(order["order"]["estimated_delivery"], {"earliest": "2026-10-20", "latest": "2026-10-22"})

    def test_product_search_keywords_filters_and_exact_id(self) -> None:
        jackets = call(self.mcp, "mock_tool_call_product_search", {"query": "waterproof jackets for rain"})
        self.assertTrue(jackets["ok"])
        self.assertEqual(jackets["results"][0]["product_id"], "SKU-1001")
        self.assertEqual(jackets["results"][0]["sizes_in_stock"], ["S", "M", "L"])
        self.assertEqual(jackets["results"][0]["currency"], "USD")
        cheap = call(self.mcp, "mock_tool_call_product_search", {"query": "jacket", "max_price": 100})
        self.assertEqual({item["product_id"] for item in cheap["results"]}, {"SKU-1001", "SKU-1003", "SKU-1005"})
        blenders = call(self.mcp, "mock_tool_call_product_search", {"category": "kitchen", "limit": 2})
        self.assertEqual((blenders["count"], blenders["total_matches"]), (2, 3))
        in_stock = call(self.mcp, "mock_tool_call_product_search", {"query": "blender", "in_stock_only": True})
        self.assertNotIn("SKU-1103", [item["product_id"] for item in in_stock["results"]])
        sold_out = call(self.mcp, "mock_tool_call_product_search", {"query": "sku-1103"})
        self.assertEqual(sold_out["count"], 1)
        self.assertFalse(sold_out["results"][0]["in_stock"])
        # Filters apply to an exact product ID too.
        for filters in ({"in_stock_only": True}, {"max_price": 10}, {"category": "outerwear"}):
            filtered = call(self.mcp, "mock_tool_call_product_search", {"query": "SKU-1103", **filters})
            self.assertEqual((filtered["ok"], filtered["count"], filtered["total_matches"], filtered["results"]), (True, 0, 0, []))
        kept = call(self.mcp, "mock_tool_call_product_search", {"query": "SKU-1001", "category": "outerwear", "in_stock_only": True})
        self.assertEqual([item["product_id"] for item in kept["results"]], ["SKU-1001"])
        nothing = call(self.mcp, "mock_tool_call_product_search", {"query": "garden hose"})
        self.assertEqual((nothing["ok"], nothing["count"]), (True, 0))
        # Only short or stop words: no searchable token, so no match instead of the whole catalog.
        for query in ("TV", "the TV"):
            unsearchable = call(self.mcp, "mock_tool_call_product_search", {"query": query})
            self.assertEqual((unsearchable["ok"], unsearchable["count"], unsearchable["total_matches"]), (True, 0, 0))
        in_category = call(self.mcp, "mock_tool_call_product_search", {"category": "audio", "in_stock_only": True})
        self.assertEqual(in_category["total_matches"], 3)
        empty = call(self.mcp, "mock_tool_call_product_search", {})
        self.assertEqual(empty["error"]["code"], "INVALID_QUERY")
        with self.assertRaises(ToolError):
            call(self.mcp, "mock_tool_call_product_search", {"query": "jacket", "limit": 11})

    def test_product_search_reports_partial_results_for_similar_names(self) -> None:
        earbuds = call(self.mcp, "mock_tool_call_product_search", {"query": "wireless earbuds", "limit": 2})
        # Headphones also match "wireless", so two results are only part of the five matches.
        self.assertEqual((earbuds["count"], earbuds["total_matches"]), (2, 5))
        self.assertEqual([item["name"] for item in earbuds["results"]], ["Wireless earbuds Pro", "Wireless earbuds"])
        everything = call(self.mcp, "mock_tool_call_product_search", {"query": "wireless earbuds", "limit": 10})
        names = {item["name"]: item["in_stock"] for item in everything["results"]}
        self.assertEqual(names["Wireless earbuds Lite"], False)
        self.assertIn("Wireless earbuds Pro", names)

    def test_order_lookup_verifies_email_before_details(self) -> None:
        verified = call(self.mcp, "mock_tool_call_order_lookup", {
            "order_number": "10045", "email": "Dana.Test20261020@example.com",
        })
        self.assertEqual(verified["order"]["customer_name"], "Dana Test")
        mismatch = call(self.mcp, "mock_tool_call_order_lookup", {"order_number": "10045", "email": "rose@edge.com"})
        self.assertEqual((mismatch["ok"], mismatch["error"]["code"], mismatch["order"]), (False, "VERIFICATION_FAILED", None))
        cancelled = call(self.mcp, "mock_tool_call_order_lookup", {"order_number": "10049"})
        self.assertEqual(cancelled["order"]["status"], "cancelled")

    def test_order_lookup_by_shared_email_asks_for_the_order_number(self) -> None:
        shared = call(self.mcp, "mock_tool_call_order_lookup", {"email": "sam.quinn@example.com"})
        self.assertEqual((shared["ok"], shared["error"]["code"], shared["order"]), (False, "MULTIPLE_ORDERS", None))
        for email, order_number in (("jordan.lee@example.com", "10046"), ("dana.test20261020@example.com", "10045")):
            single = call(self.mcp, "mock_tool_call_order_lookup", {"email": email})
            self.assertEqual(single["order"]["order_number"], order_number)
        second = call(self.mcp, "mock_tool_call_order_lookup", {"order_number": "10050", "email": "sam.quinn@example.com"})
        self.assertEqual(second["order"]["order_number"], "10050")
        not_dana = call(self.mcp, "mock_tool_call_order_lookup", {
            "order_number": "10050", "email": "dana.test20261020@example.com",
        })
        self.assertEqual(not_dana["error"]["code"], "VERIFICATION_FAILED")

    def test_cart_add_item_checks_product_stock_and_size(self) -> None:
        added = call(self.mcp, "mock_tool_call_cart_add_item", {"product_id": "SKU-1001", "quantity": 2, "size": "m"})
        self.assertTrue(added["ok"])
        self.assertRegex(added["cart_id"], r"^CART-[0-9A-Z]{6}$")
        self.assertEqual(added["line"]["size"], "M")
        self.assertEqual(added["line"]["line_total"], 178.0)
        no_size = call(self.mcp, "mock_tool_call_cart_add_item", {"product_id": "SKU-1001"})
        self.assertEqual(no_size["error"]["code"], "SIZE_REQUIRED")
        wrong_size = call(self.mcp, "mock_tool_call_cart_add_item", {"product_id": "SKU-1001", "size": "XL"})
        self.assertEqual(wrong_size["error"]["code"], "SIZE_UNAVAILABLE")
        sold_out = call(self.mcp, "mock_tool_call_cart_add_item", {"product_id": "SKU-1103"})
        self.assertEqual(sold_out["error"]["code"], "OUT_OF_STOCK")
        unknown = call(self.mcp, "mock_tool_call_cart_add_item", {"product_id": "SKU-9999"})
        self.assertEqual(unknown["error"]["code"], "PRODUCT_NOT_FOUND")
        no_sizes = call(self.mcp, "mock_tool_call_cart_add_item", {"product_id": "SKU-1101"})
        self.assertIsNone(no_sizes["line"]["size"])

    def test_hotel_flow(self) -> None:
        available = call(self.mcp, "mock_tool_call_hotel_check_availability", {
            "check_in": "2026-10-23", "check_out": "2026-10-25", "guests": 2,
        })
        rooms = {room["room_type"]: room for room in available["rooms"]}
        self.assertEqual(rooms["Classic King"]["total_before_taxes"], 458)
        self.assertFalse(rooms["Junior Suite"]["available"])
        booked = call(self.mcp, "mock_tool_call_hotel_create_reservation", {
            "first_name": "Dana", "last_name": "Test", "email": "dana.test20261020@example.com",
            "room_type": "Classic King", "check_in": "2026-10-23", "check_out": "2026-10-25", "guests": 2,
        })
        self.assertRegex(booked["confirmation_number"], r"^M[0-9A-Z]{5}$")
        not_kept = call(self.mcp, "mock_tool_call_hotel_get_reservation", {
            "confirmation_number": booked["confirmation_number"], "last_name": "Test",
        })
        self.assertEqual(not_kept["error"]["code"], "RESERVATION_NOT_FOUND")
        found = call(self.mcp, "mock_tool_call_hotel_get_reservation", {"confirmation_number": "a1b2c3", "last_name": "test"})
        self.assertEqual(found["reservation"]["room_type"], "Classic King")
        cancelled = call(self.mcp, "mock_tool_call_hotel_cancel_reservation", {"confirmation_number": "A1B2C3", "last_name": "Test"})
        self.assertEqual((cancelled["status"], cancelled["cancellation_fee"]), ("cancelled", 0))
        # The seed reservation is not left cancelled for the next caller.
        again = call(self.mcp, "mock_tool_call_hotel_get_reservation", {
            "confirmation_number": "A1B2C3", "last_name": "Test",
        })
        self.assertEqual(again["reservation"]["status"], "confirmed")

    def test_restaurant_availability_offers_nearby_times_and_rejects_bad_requests(self) -> None:
        friday = call(self.mcp, "mock_tool_call_restaurant_check_availability", {
            "date": "2026-10-23", "time": "19:00", "party_size": 4,
        })
        self.assertTrue(friday["ok"])
        self.assertFalse(friday["requested_time_available"])
        self.assertEqual(friday["available_times"], ["17:30", "18:00", "18:30", "20:00"])
        self.assertEqual((friday["first_seating"], friday["last_seating"], friday["seating"]), ("17:00", "22:00", "dining room"))
        self.assertEqual((friday["today"], friday["today_weekday"], friday["weekday"]), ("2026-10-20", "Tuesday", "Friday"))
        thursday = call(self.mcp, "mock_tool_call_restaurant_check_availability", {
            "date": "2026-10-22", "time": "7:30 PM", "party_size": 2, "seating": "Patio",
        })
        self.assertEqual((thursday["requested_time"], thursday["requested_time_available"], thursday["seating"]), ("19:30", True, "patio"))
        failures = {
            "CLOSED": {"date": "2026-10-26", "time": "19:00", "party_size": 2},
            "LARGE_PARTY": {"date": "2026-10-22", "time": "19:00", "party_size": 9},
            "INVALID_REQUEST": {"date": "2026-10-22", "time": "19:00", "party_size": 7, "seating": "patio"},
        }
        for code, arguments in failures.items():
            with self.subTest(code=code):
                result = call(self.mcp, "mock_tool_call_restaurant_check_availability", arguments)
                self.assertFalse(result["ok"])
                self.assertEqual(result["error"]["code"], code)
                self.assertEqual(result["today"], "2026-10-20")
        past = call(self.mcp, "mock_tool_call_restaurant_check_availability", {"date": "2026-10-19", "time": "19:00", "party_size": 2})
        self.assertEqual(past["error"]["code"], "INVALID_REQUEST")

    def test_restaurant_booking_lookup_and_cancellation(self) -> None:
        booked = call(self.mcp, "mock_tool_call_restaurant_create_reservation", {
            "first_name": "Ana", "last_name": "Mock", "phone": "+1 425 555 0142", "date": "2026-10-22",
            "time": "19:30", "party_size": 2, "occasion": "anniversary",
        })
        self.assertTrue(booked["ok"])
        self.assertRegex(booked["confirmation_number"], r"^R[0-9A-Z]{5}$")
        self.assertEqual((booked["phone"], booked["time"], booked["seating"]), ("+14255550142", "19:30", "dining room"))
        full = call(self.mcp, "mock_tool_call_restaurant_create_reservation", {
            "first_name": "Ana", "last_name": "Mock", "phone": "+14255550142", "date": "2026-10-23",
            "time": "19:00", "party_size": 2,
        })
        self.assertEqual(full["error"]["code"], "TIME_UNAVAILABLE")
        self.assertIn("18:30", full["available_times"])
        bad_phone = call(self.mcp, "mock_tool_call_restaurant_create_reservation", {
            "first_name": "Ana", "last_name": "Mock", "phone": "555-0142", "date": "2026-10-22",
            "time": "19:30", "party_size": 2,
        })
        self.assertEqual(bad_phone["error"]["code"], "INVALID_PHONE")
        not_kept = call(self.mcp, "mock_tool_call_restaurant_get_reservation", {
            "confirmation_number": booked["confirmation_number"], "last_name": "Mock",
        })
        self.assertEqual(not_kept["error"]["code"], "RESERVATION_NOT_FOUND")
        found = call(self.mcp, "mock_tool_call_restaurant_get_reservation", {"confirmation_number": "tr4k7q", "last_name": "test"})
        self.assertEqual(
            (found["reservation"]["date"], found["reservation"]["time"], found["reservation"]["party_size"]),
            ("2026-10-23", "19:00", 4),
        )
        self.assertEqual(found["reservation"]["phone"], "+14255550111")
        wrong_name = call(self.mcp, "mock_tool_call_restaurant_cancel_reservation", {"confirmation_number": "TR4K7Q", "last_name": "Lee"})
        self.assertEqual(wrong_name["error"]["code"], "RESERVATION_NOT_FOUND")
        cancelled = call(self.mcp, "mock_tool_call_restaurant_cancel_reservation", {"confirmation_number": "TR4K7Q", "last_name": "Test"})
        self.assertEqual(cancelled["status"], "cancelled")
        again = call(self.mcp, "mock_tool_call_restaurant_get_reservation", {"confirmation_number": "TR4K7Q", "last_name": "Test"})
        self.assertEqual(again["reservation"]["status"], "confirmed")

    def test_coaching_and_research_records(self) -> None:
        quiz = call(self.mcp, "mock_tool_call_quiz_record_result", {
            "quiz_name": "Security awareness basics", "score": 8, "total": 10, "passing_score": 7,
        })
        self.assertTrue(quiz["passed"])
        session = call(self.mcp, "mock_tool_call_training_record_session", {
            "scenario": "Angry customer", "communication": 4, "objection_handling": 3,
            "empathy": 5, "resolution": 3, "key_takeaway": "Name the next step.",
        })
        self.assertRegex(session["record_id"], r"^TS-\d{4}$")
        refused = call(self.mcp, "mock_tool_call_research_save_interview_notes", {
            "consent_given": False, "summary": "Plans in a spreadsheet.",
        })
        self.assertEqual(refused["error"]["code"], "CONSENT_REQUIRED")


DANA_MEMBER = {"member_id": "M-204518", "card_last4": "4417"}
DANA_RX = {"last_name": "Test", "date_of_birth": "1990-02-14"}


class MembershipToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def code(self, name: str, arguments: dict[str, Any]) -> str | None:
        result = call(self.mcp, "mock_tool_call_membership_" + name, arguments)
        self.assertIn("today", result)
        return None if result["ok"] else result["error"]["code"]

    def test_lookup_needs_the_card_last_four_and_reveals_nothing_otherwise(self) -> None:
        found = call(self.mcp, "mock_tool_call_membership_lookup", {"member_id": "m 204518", "card_last4": "4 4 1 7"})
        member = found["member"]
        self.assertEqual((member["plan_name"], member["price_usd"], member["status"]), ("Plus", 49.0, "active"))
        self.assertEqual(member["next_billing_date"], "2026-10-29")
        self.assertEqual(member["current_period_end"], "2026-10-28")
        self.assertEqual(member["pause_options"], [1, 2, 3])
        self.assertEqual([o["offer_id"] for o in member["eligible_offers"]], ["OFFER-DOWN-BASIC", "OFFER-50OFF-2M"])
        by_email = call(self.mcp, "mock_tool_call_membership_lookup", {
            "email": "Dana.Test20261020@example.com", "card_last4": "4417",
        })
        self.assertEqual(by_email["member"]["member_id"], "M-204518")
        for arguments, code in [
            ({"member_id": "M-204518", "card_last4": "1111"}, "VERIFICATION_FAILED"),
            ({"member_id": "M-204518", "email": "jordan.lee@example.com", "card_last4": "4417"}, "VERIFICATION_FAILED"),
            ({"member_id": "M-999999", "card_last4": "4417"}, "NOT_FOUND"),
        ]:
            with self.subTest(arguments=arguments):
                result = call(self.mcp, "mock_tool_call_membership_lookup", arguments)
                self.assertEqual(result["error"]["code"], code)
                self.assertNotIn("Plus", json.dumps(result))
        with self.assertRaises(ToolError):
            call(self.mcp, "mock_tool_call_membership_lookup", {"card_last4": "4417"})

    def test_annual_member_gets_no_pause_and_no_discount(self) -> None:
        member = call(self.mcp, "mock_tool_call_membership_lookup", {"member_id": "M-204519", "card_last4": "8823"})["member"]
        self.assertEqual(member["billing_cycle"], "annual")
        self.assertEqual(member["pause_options"], [])
        self.assertEqual([o["offer_id"] for o in member["eligible_offers"]], ["OFFER-DOWN-PLUS-AT-RENEWAL"])

    def test_change_plan_outcomes(self) -> None:
        changed = call(self.mcp, "mock_tool_call_membership_change_plan", {**DANA_MEMBER, "new_plan_id": "premium"})
        self.assertTrue(changed["ok"])
        self.assertEqual((changed["new_plan_name"], changed["new_price_usd"]), ("Premium", 79.0))
        self.assertEqual(changed["effective_date"], "2026-10-29")
        self.assertRegex(changed["change_id"], r"^CHG-\d{5}$")
        cases = [
            ({**DANA_MEMBER, "new_plan_id": "plus"}, "SAME_PLAN"),
            ({"member_id": "M-204519", "card_last4": "8823", "new_plan_id": "plus"}, "PLAN_NOT_AVAILABLE"),
            ({"member_id": "M-204521", "card_last4": "3390", "new_plan_id": "plus"}, "PAST_DUE"),
            ({"member_id": "M-204522", "card_last4": "7001", "new_plan_id": "basic"}, "NOT_ACTIVE"),
            ({"member_id": "M-204518", "card_last4": "0000", "new_plan_id": "basic"}, "VERIFICATION_FAILED"),
        ]
        for arguments, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(self.code("change_plan", arguments), expected)

    def test_pause_outcomes(self) -> None:
        paused = call(self.mcp, "mock_tool_call_membership_pause", {**DANA_MEMBER, "months": 2})
        self.assertEqual((paused["pause_start"], paused["resume_date"]), ("2026-10-29", "2026-12-29"))
        for arguments, expected in [
            ({"member_id": "M-204520", "card_last4": "1209", "months": 1}, "ALREADY_PAUSED"),
            ({"member_id": "M-204519", "card_last4": "8823", "months": 1}, "PAUSE_NOT_ELIGIBLE"),
            ({"member_id": "M-204521", "card_last4": "3390", "months": 1}, "PAST_DUE"),
            ({"member_id": "M-204523", "card_last4": "5150", "months": 1}, "NOT_ACTIVE"),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(self.code("pause", arguments), expected)
        with self.assertRaises(ToolError):
            call(self.mcp, "mock_tool_call_membership_pause", {**DANA_MEMBER, "months": 4})

    def test_retention_offer_only_when_listed_for_the_member(self) -> None:
        applied = call(self.mcp, "mock_tool_call_membership_apply_retention_offer", {**DANA_MEMBER, "offer_id": "OFFER-50OFF-2M"})
        self.assertEqual((applied["new_price_usd"], applied["effective_date"], applied["ends_on"]), (24.5, "2026-10-29", "2026-12-28"))
        self.assertEqual(self.code("apply_retention_offer", {
            "member_id": "M-204519", "card_last4": "8823", "offer_id": "OFFER-50OFF-2M",
        }), "OFFER_NOT_ELIGIBLE")
        self.assertEqual(self.code("apply_retention_offer", {**DANA_MEMBER, "offer_id": "FREE-3-MONTHS"}), "OFFER_NOT_ELIGIBLE")
        self.assertEqual(self.code("apply_retention_offer", {
            "member_id": "M-204522", "card_last4": "7001", "offer_id": "OFFER-DOWN-BASIC",
        }), "NOT_ACTIVE")

    def test_cancel_outcomes_and_nothing_is_stored(self) -> None:
        cancelled = call(self.mcp, "mock_tool_call_membership_cancel", {**DANA_MEMBER, "reason": "price"})
        self.assertEqual((cancelled["effective_date"], cancelled["access_until"]), ("2026-10-28", "2026-10-28"))
        self.assertRegex(cancelled["cancellation_id"], r"^CXL-\d{5}$")
        self.assertEqual(self.code("cancel", {"member_id": "M-204522", "card_last4": "7001"}), "ALREADY_CANCELLED")
        pending = call(self.mcp, "mock_tool_call_membership_cancel", {"member_id": "M-204523", "card_last4": "5150"})
        self.assertEqual((pending["error"]["code"], pending["effective_date"]), ("PENDING_CANCEL", "2026-10-25"))
        later = call(self.mcp, "mock_tool_call_membership_lookup", DANA_MEMBER)
        self.assertEqual(later["member"]["status"], "active")


class ShipmentToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def track(self, tracking_number: str, postal_code: str = "") -> dict[str, Any]:
        return call(self.mcp, "mock_tool_call_shipment_track", {"tracking_number": tracking_number, "postal_code": postal_code})

    def test_delivered_location_needs_the_postal_code(self) -> None:
        plain = self.track("CP10447204")
        self.assertEqual(plain["today_weekday"], "Tuesday")
        self.assertEqual(plain["shipment"]["status"], "delivered")
        self.assertNotIn("delivered", plain["shipment"])
        self.assertNotIn("Front door", json.dumps(plain))
        verified = self.track("c p 1044-7204", "98052")["shipment"]
        self.assertTrue(verified["address_verified"])
        self.assertEqual(verified["delivered"]["location"], "Front door")
        self.assertTrue(verified["delivered"]["trace_eligible"])
        recent = self.track("CP10447210", "98052")["shipment"]["delivered"]
        self.assertFalse(recent["trace_eligible"])
        mismatch = self.track("CP10447204", "98101")
        self.assertEqual(mismatch["error"]["code"], "POSTAL_CODE_MISMATCH")
        self.assertIsNone(mismatch["shipment"])
        self.assertEqual(self.track("CP99999999")["error"]["code"], "NOT_FOUND")

    def test_out_for_delivery_window_and_weather_estimate(self) -> None:
        out = self.track("CP10447201")["shipment"]
        self.assertEqual(out["delivery_window"], {"start": "14:00", "end": "18:00"})
        self.assertEqual(out["estimated_delivery_date"], "2026-10-20")
        weather = self.track("CP10447205")["shipment"]
        self.assertEqual((weather["exception_code"], weather["estimated_delivery_date"]), ("WEATHER_DELAY", "2026-10-22"))

    def test_redelivery_dates_skip_sunday(self) -> None:
        attempted = self.track("CP10447202", "98101")["shipment"]
        self.assertEqual(attempted["redelivery_dates"], ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-26"])
        booked = call(self.mcp, "mock_tool_call_shipment_schedule_redelivery", {
            "tracking_number": "CP10447202", "postal_code": "98101", "date": "2026-10-22",
        })
        self.assertEqual((booked["weekday"], booked["window"]), ("Thursday", {"start": "12:00", "end": "18:00"}))
        self.assertRegex(booked["redelivery_id"], r"^RD-\d{5}$")
        sunday = call(self.mcp, "mock_tool_call_shipment_schedule_redelivery", {
            "tracking_number": "CP10447202", "postal_code": "98101", "date": "2026-10-25",
        })
        self.assertEqual(sunday["error"]["code"], "DATE_UNAVAILABLE")
        self.assertEqual(sunday["available_dates"], attempted["redelivery_dates"])
        for tracking, postal, reason in [
            ("CP10447204", "98052", "delivered"), ("CP10447208", "98004", "returned"),
            ("CP10447207", "98101", "held"), ("CP10447201", "98052", "not_attempted"),
        ]:
            with self.subTest(tracking=tracking):
                result = call(self.mcp, "mock_tool_call_shipment_schedule_redelivery", {
                    "tracking_number": tracking, "postal_code": postal, "date": "2026-10-22",
                })
                self.assertEqual((result["error"]["code"], result["reason"]), ("NOT_ELIGIBLE", reason))

    def test_update_delivery_outcomes(self) -> None:
        def update(tracking: str, postal: str, action: str, **extra: str) -> dict[str, Any]:
            return call(self.mcp, "mock_tool_call_shipment_update_delivery", {
                "tracking_number": tracking, "postal_code": postal, "action": action, **extra,
            })

        hold = update("CP10447202", "98101", "hold_at_pickup_point", pickup_point_id="PP-1021")
        self.assertEqual(hold["pickup_point"]["name"], "Contoso Parcel Point - Pike Street")
        self.assertEqual(hold["hold_until"], "2026-10-26")
        self.assertTrue(update("CP10447201", "98052", "add_instructions", instructions="Leave at the back door")["ok"])
        unit = update("CP10447203", "98004", "correct_unit", unit="4B")
        self.assertIn("4B", unit["summary"])
        for result, expected in [
            (update("CP10447201", "98052", "hold_at_pickup_point", pickup_point_id="PP-2051"), "TOO_LATE"),
            (update("CP10447202", "98101", "hold_at_pickup_point", pickup_point_id="PP-2051"), "PICKUP_POINT_NOT_FOUND"),
            (update("CP10447209", "98052", "add_instructions", instructions="Side gate"), "NOT_ALLOWED_BY_SENDER"),
            (update("CP10447204", "98052", "add_instructions", instructions="Side gate"), "ALREADY_DELIVERED"),
            (update("CP10447201", "98101", "add_instructions", instructions="Side gate"), "POSTAL_CODE_MISMATCH"),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(result["error"]["code"], expected)
        later = self.track("CP10447201", "98052")["shipment"]
        self.assertEqual(later["status"], "out_for_delivery")


class PharmacyToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def refill(self, rx_number: str, last_name: str, date_of_birth: str) -> dict[str, Any]:
        return call(self.mcp, "mock_tool_call_pharmacy_refill_submit", {
            "rx_number": rx_number, "last_name": last_name, "date_of_birth": date_of_birth,
        })

    def test_lookup_needs_rx_name_and_birth_date(self) -> None:
        found = call(self.mcp, "mock_tool_call_pharmacy_rx_lookup", {"rx_number": "601 0231", **DANA_RX})
        rx = found["rx"]
        self.assertEqual((rx["drug_name"], rx["strength"], rx["refills_remaining"]), ("Atorvastatin", "20 mg", 3))
        self.assertTrue(rx["can_refill_now"])
        self.assertEqual(found["store"]["address"], "120 Pine Street")
        for arguments, code in [
            ({"rx_number": "6010231", "last_name": "Test", "date_of_birth": "1990-02-15"}, "VERIFICATION_FAILED"),
            ({"rx_number": "6010231", "last_name": "Lee", "date_of_birth": "1990-02-14"}, "VERIFICATION_FAILED"),
            ({"rx_number": "6099999", **DANA_RX}, "NOT_FOUND"),
        ]:
            with self.subTest(arguments=arguments):
                result = call(self.mcp, "mock_tool_call_pharmacy_rx_lookup", arguments)
                self.assertEqual(result["error"]["code"], code)
                self.assertNotIn("Atorvastatin", json.dumps(result))
        sertraline = call(self.mcp, "mock_tool_call_pharmacy_rx_lookup", {
            "rx_number": "6020418", "last_name": "Lee", "date_of_birth": "1985-03-14",
        })["rx"]
        self.assertEqual((sertraline["refill_blocked_reason"], sertraline["earliest_refill_date"]), ("TOO_SOON", "2026-11-02"))

    def test_refill_ready_time_follows_the_cutoff(self) -> None:
        submitted = self.refill("6010231", "Test", "1990-02-14")
        self.assertEqual(submitted["ready_by"], {"date": "2026-10-20", "weekday": "Tuesday", "time": "14:00"})
        self.assertEqual(submitted["refills_remaining_after"], 2)
        self.assertRegex(submitted["refill_id"], r"^RF-\d{5}$")
        # 6 PM Pacific is after the 5 PM cutoff: ready the next day at 11 AM.
        evening = build(MockToolCallService(clock=lambda: datetime(2026, 10, 21, 1, 0, tzinfo=timezone.utc)))
        late = call(evening, "mock_tool_call_pharmacy_refill_submit", {"rx_number": "6010231", **DANA_RX})
        self.assertEqual(late["ready_by"], {"date": "2026-10-21", "weekday": "Wednesday", "time": "11:00"})

    def test_refill_failure_codes(self) -> None:
        jordan, sam = ("Lee", "1985-03-14"), ("Quinn", "1992-07-30")
        for rx_number, person, expected in [
            ("6010232", ("Test", "1990-02-14"), "NO_REFILLS_LEFT"),
            ("6010233", ("Test", "1990-02-14"), "ALREADY_IN_PROGRESS"),
            ("6020418", jordan, "TOO_SOON"),
            ("6020419", jordan, "CONTROLLED_SUBSTANCE"),
            ("6030555", sam, "TRANSFERRED_OUT"),
            ("6030556", sam, "PRESCRIPTION_EXPIRED"),
            ("6030557", sam, "NO_REFILLS_LEFT"),
        ]:
            with self.subTest(rx=rx_number):
                result = self.refill(rx_number, *person)
                self.assertEqual(result["error"]["code"], expected)
        self.assertEqual(self.refill("6010233", "Test", "1990-02-14")["refill_id"], "RF-20417")
        self.assertEqual(self.refill("6020418", *jordan)["earliest_refill_date"], "2026-11-02")

    def test_renewal_outcomes(self) -> None:
        def renew(rx_number: str, last_name: str, date_of_birth: str) -> dict[str, Any]:
            return call(self.mcp, "mock_tool_call_pharmacy_renewal_request", {
                "rx_number": rx_number, "last_name": last_name, "date_of_birth": date_of_birth,
            })

        sent = renew("6010232", "Test", "1990-02-14")
        self.assertEqual((sent["prescriber_name"], sent["typical_response_business_days"]), ("Dr. Avery Rivera", 2))
        self.assertRegex(sent["renewal_id"], r"^RN-\d{5}$")
        self.assertTrue(renew("6020419", "Lee", "1985-03-14")["ok"])
        self.assertTrue(renew("6030556", "Quinn", "1992-07-30")["ok"])
        pending = renew("6030557", "Quinn", "1992-07-30")
        self.assertEqual((pending["error"]["code"], pending["renewal_id"]), ("RENEWAL_ALREADY_PENDING", "RN-30112"))
        self.assertEqual(renew("6010231", "Test", "1990-02-14")["error"]["code"], "REFILLS_REMAIN")
        self.assertEqual(renew("6030555", "Quinn", "1992-07-30")["error"]["code"], "TRANSFERRED_OUT")
        self.assertEqual(renew("6010232", "Test", "1990-01-01")["error"]["code"], "VERIFICATION_FAILED")


class NoRetentionTests(unittest.TestCase):
    """Caller-provided data must never be kept or shown to a later caller."""

    SECRET = "Zyxwvut Qqqprivate"

    def test_writes_leave_no_caller_data_behind(self) -> None:
        service = MockToolCallService(clock=lambda: NOW, rng=random.Random(11))
        attributes = set(vars(service))
        fixtures = copy.deepcopy(service._fixtures)
        mcp = build(service)
        email = "zyxwvut.private@example.com"
        writes = [
            ("mock_tool_call_create_event", {
                "subject": f"Visit with {self.SECRET}", "startDateTime": "2026-10-22T09:00:00",
                "endDateTime": "2026-10-22T09:30:00", "timeZone": "Pacific Standard Time",
                "attendeeEmails": [email], "body": self.SECRET,
            }),
            ("mock_tool_call_zendesk_create_ticket", {
                "subject": self.SECRET, "description": self.SECRET, "requester_name": self.SECRET,
                "requester_email": email,
            }),
            ("mock_tool_call_zendesk_add_comment", {"ticket_id": "3", "comment": self.SECRET}),
            ("mock_tool_call_salesforce_create_lead", {
                "last_name": self.SECRET, "company": self.SECRET, "email": email,
            }),
            ("mock_tool_call_send_email_with_attachments", {"to": email, "subject": self.SECRET, "body": self.SECRET}),
            ("mock_tool_call_twilio_send_message", {"to": "+14255550199", "body": self.SECRET}),
            ("mock_tool_call_hotel_create_reservation", {
                "first_name": self.SECRET, "last_name": self.SECRET, "email": email,
                "room_type": "Classic King", "check_in": "2026-10-23", "check_out": "2026-10-24", "guests": 1,
            }),
            ("mock_tool_call_research_save_interview_notes", {
                "consent_given": True, "participant_name": self.SECRET, "summary": self.SECRET,
            }),
            ("mock_tool_call_cart_add_item", {"product_id": "SKU-1101", "quantity": 1}),
            ("mock_tool_call_restaurant_create_reservation", {
                "first_name": self.SECRET, "last_name": self.SECRET, "phone": "+14255550199", "date": "2026-10-22",
                "time": "18:00", "party_size": 2, "special_requests": self.SECRET,
            }),
            ("mock_tool_call_membership_cancel", {**DANA_MEMBER, "reason": "other", "note": self.SECRET}),
            ("mock_tool_call_shipment_update_delivery", {
                "tracking_number": "CP10447201", "postal_code": "98052", "action": "add_instructions",
                "instructions": self.SECRET,
            }),
            ("mock_tool_call_pharmacy_renewal_request", {"rx_number": "6010232", **DANA_RX, "note": self.SECRET}),
        ]
        for name, arguments in writes:
            with self.subTest(tool=name):
                self.assertTrue(call(mcp, name, arguments)["ok"])
        # No new attribute holds caller data, and the fixtures were not modified in place.
        self.assertEqual(set(vars(service)), attributes)
        self.assertEqual(service._fixtures, fixtures)
        reads = [
            ("mock_tool_call_list_calendar_view", {
                "startDateTime": "2026-10-22T00:00:00", "endDateTime": "2026-10-22T23:59:00",
                "timeZone": "Pacific Standard Time", "subject": "",
            }),
            ("mock_tool_call_zendesk_search", {"query": self.SECRET, "type": "tickets"}),
            ("mock_tool_call_zendesk_search", {"query": "401", "type": "tickets"}),
            ("mock_tool_call_salesforce_search", {"email": email}),
            ("mock_tool_call_membership_lookup", DANA_MEMBER),
            ("mock_tool_call_shipment_track", {"tracking_number": "CP10447201", "postal_code": "98052"}),
            ("mock_tool_call_pharmacy_rx_lookup", {"rx_number": "6010232", **DANA_RX}),
        ]
        for name, arguments in reads:
            with self.subTest(tool=name):
                text = json.dumps(call(mcp, name, arguments))
                self.assertNotIn("Zyxwvut", text)
                self.assertNotIn("zyxwvut", text)

    def test_ids_are_not_sequential_across_callers(self) -> None:
        first = call(build(), "mock_tool_call_zendesk_create_ticket", {"subject": "S", "description": "D"})
        other = build(MockToolCallService(clock=lambda: NOW, rng=random.Random(99)))
        second = call(other, "mock_tool_call_zendesk_create_ticket", {"subject": "S", "description": "D"})
        self.assertNotEqual(first["ticket_id"], second["ticket_id"])
        self.assertTrue(re.fullmatch(r"\d{4}", str(second["ticket_id"])))


if __name__ == "__main__":
    unittest.main()
