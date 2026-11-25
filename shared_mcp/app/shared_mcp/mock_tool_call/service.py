from __future__ import annotations

import json
import logging
import math
import random
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


logger = logging.getLogger("shared_mcp.mock_tool_call")

FIXTURES_PATH = Path(__file__).resolve().with_name("fixtures.json")
TOOL_PREFIX = "mock_tool_call_"
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
E164 = re.compile(r"^\+[1-9]\d{7,14}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DINING_TIME = re.compile(r"^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?$", re.IGNORECASE)
DURATION = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?$", re.IGNORECASE)
WINDOWS_TIME_ZONES = {
    "dateline standard time": "Etc/GMT+12",
    "hawaiian standard time": "Pacific/Honolulu",
    "alaskan standard time": "America/Anchorage",
    "pacific standard time": "America/Los_Angeles",
    "mountain standard time": "America/Denver",
    "us mountain standard time": "America/Phoenix",
    "central standard time": "America/Chicago",
    "eastern standard time": "America/New_York",
    "atlantic standard time": "America/Halifax",
    "e. south america standard time": "America/Sao_Paulo",
    "utc": "UTC",
    "coordinated universal time": "UTC",
    "gmt standard time": "Europe/London",
    "w. europe standard time": "Europe/Berlin",
    "central europe standard time": "Europe/Budapest",
    "romance standard time": "Europe/Paris",
    "central european standard time": "Europe/Warsaw",
    "e. europe standard time": "Europe/Chisinau",
    "south africa standard time": "Africa/Johannesburg",
    "russian standard time": "Europe/Moscow",
    "arabian standard time": "Asia/Dubai",
    "india standard time": "Asia/Kolkata",
    "se asia standard time": "Asia/Bangkok",
    "china standard time": "Asia/Shanghai",
    "singapore standard time": "Asia/Singapore",
    "taipei standard time": "Asia/Taipei",
    "tokyo standard time": "Asia/Tokyo",
    "korea standard time": "Asia/Seoul",
    "aus eastern standard time": "Australia/Sydney",
    "new zealand standard time": "Pacific/Auckland",
}
PRODUCT_CURRENCY = "USD"
GENERATED_EVENT_ID = re.compile(r"^mock-evt-[0-9a-f]{8}$")
# Ticket IDs that create_ticket hands out; anything in this range is treated as created earlier in the call.
GENERATED_TICKET_IDS = range(1000, 10000)
STOP_WORDS = {
    "the", "and", "for", "with", "how", "what", "why", "can", "does", "not", "my", "our",
    "you", "your", "is", "are", "was", "to", "of", "in", "on", "a", "an", "i", "it", "do",
    "get", "when", "after", "from", "this", "that", "still", "keeps", "need", "help",
}


class MockToolCallService:
    """Fake business systems for the Voice Agent template catalog.

    Stateless by design: write tools validate their arguments and return a generated ID, but
    nothing a caller says is stored, so no caller can see another caller's data. Reads return
    only the fixed fictional fixtures, computed per call.
    """

    def __init__(
        self,
        fixtures: dict[str, Any] | None = None,
        *,
        clock: Callable[[], datetime] | None = None,
        rng: random.Random | None = None,
    ) -> None:
        self._fixtures = fixtures if fixtures is not None else load_fixtures()
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._rng = rng or random.SystemRandom()
        self._user_zone_name = str(self._fixtures["calendar"]["user_time_zone"])

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _ok(tool: str, **payload: Any) -> dict[str, Any]:
        return {"mock": True, "tool": TOOL_PREFIX + tool, "ok": True, **payload, "error": None}

    @staticmethod
    def _fail(tool: str, code: str, message: str, **payload: Any) -> dict[str, Any]:
        logger.info("mock tool %s business failure %s", tool, code)
        return {
            "mock": True,
            "tool": TOOL_PREFIX + tool,
            "ok": False,
            **payload,
            "error": {"code": code, "message": message},
        }

    def _today(self, zone: ZoneInfo | None = None) -> date:
        return self._clock().astimezone(zone or self._zone(self._user_zone_name)).date()

    @staticmethod
    def _zone(name: str) -> ZoneInfo:
        key = WINDOWS_TIME_ZONES.get(name.strip().lower(), name.strip())
        try:
            return ZoneInfo(key)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise UnknownTimeZone(name) from error

    @staticmethod
    def _local(value: str, zone: ZoneInfo) -> datetime:
        text = value.strip().replace("Z", "+00:00")
        text = re.sub(r"(\.\d{6})\d+", r"\1", text)
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=zone)
        return parsed.astimezone(zone)

    @staticmethod
    def _graph_time(moment: datetime, zone_name: str) -> dict[str, str]:
        return {
            "dateTime": moment.strftime("%Y-%m-%dT%H:%M:%S") + ".0000000",
            "timeZone": zone_name,
        }

    @staticmethod
    def _minutes(duration: str) -> int:
        match = DURATION.fullmatch(duration.strip())
        if not match or not (match.group(1) or match.group(2)):
            raise ValueError("meetingDuration must be an ISO 8601 duration such as PT30M or PT1H30M")
        return int(match.group(1) or 0) * 60 + int(match.group(2) or 0)

    # ----------------------------------------------------------------- echo

    @staticmethod
    def echo(request_id: str, text: str, mode: str) -> dict[str, Any]:
        logger.info("mock_tool_call_echo request_id=%s mode=%s", request_id, mode)
        if mode == "business_error":
            return {
                "mock": True,
                "tool": "mock_tool_call_echo",
                "request_id": request_id,
                "status": "failed",
                "data": None,
                "error": {
                    "code": "MOCK_BUSINESS_ERROR",
                    "message": "Synthetic business failure requested by the caller.",
                },
            }
        return {
            "mock": True,
            "tool": "mock_tool_call_echo",
            "request_id": request_id,
            "status": "succeeded",
            "data": {"text": text},
            "error": None,
        }

    # ------------------------------------------------------------- calendar

    def _events(self) -> list[dict[str, Any]]:
        """The fixture seed events, placed relative to today on every call."""
        events = []
        for seed in self._fixtures["calendar"]["seed_events"]:
            zone = self._zone(seed["time_zone"])
            today = self._today(zone)
            offset = (WEEKDAYS.index(seed["weekday"]) - today.weekday()) % 7 or 7
            hour, minute = (int(part) for part in seed["start"].split(":"))
            start = datetime.combine(today + timedelta(days=offset), time(hour, minute), zone)
            events.append({
                "id": seed["id"],
                "subject": seed["subject"],
                "start_utc": start.astimezone(timezone.utc).isoformat(),
                "end_utc": (start + timedelta(minutes=seed["minutes"])).astimezone(timezone.utc).isoformat(),
                "time_zone": seed["time_zone"],
                "attendees": list(seed["attendees"]),
                "is_online_meeting": bool(seed["is_online_meeting"]),
                "location": "",
                "body": "",
                "cancelled": False,
            })
        return events

    def _seed_event(self, event_id: str) -> dict[str, Any] | None:
        return next((event for event in self._events() if event["id"] == event_id), None)

    def _event_view(self, event: dict[str, Any], zone_name: str | None = None) -> dict[str, Any]:
        name = zone_name or event["time_zone"]
        zone = self._zone(name)
        start = datetime.fromisoformat(event["start_utc"]).astimezone(zone)
        end = datetime.fromisoformat(event["end_utc"]).astimezone(zone)
        view = {
            "id": event["id"],
            "subject": event["subject"],
            "start": self._graph_time(start, name),
            "end": self._graph_time(end, name),
            "dayOfWeek": WEEKDAYS[start.weekday()],
            "isCancelled": bool(event.get("cancelled")),
            "isOnlineMeeting": bool(event.get("is_online_meeting")),
            "location": {"displayName": event.get("location") or ""},
            "attendees": [
                {"emailAddress": {"address": address}, "type": "required"}
                for address in event.get("attendees") or []
            ],
        }
        if event.get("is_online_meeting"):
            view["onlineMeeting"] = {"joinUrl": f"https://teams.example.invalid/mock/{event['id']}"}
        return view

    def find_meeting_times(
        self,
        meeting_duration: str,
        start_date_time: str,
        end_date_time: str,
        time_zone: str,
        attendee_emails: list[str],
        max_candidates: int,
        return_suggestion_reasons: bool,
    ) -> dict[str, Any]:
        tool = "find_meeting_times"
        try:
            zone = self._zone(time_zone)
            minutes = self._minutes(meeting_duration)
            start = self._local(start_date_time, zone)
            end = self._local(end_date_time, zone)
        except UnknownTimeZone:
            return self._fail(tool, "UNKNOWN_TIME_ZONE", f"Unknown time zone '{time_zone}'.")
        except ValueError as error:
            return self._fail(tool, "INVALID_ARGUMENT", str(error))
        if not 15 <= minutes <= 480:
            return self._fail(tool, "INVALID_ARGUMENT", "meetingDuration must be 15 minutes to 8 hours.")
        if end <= start or end - start > timedelta(days=14):
            return self._fail(tool, "INVALID_ARGUMENT", "The search window must end after it starts and span at most 14 days.")
        day_start = start.time() if time(6) <= start.time() < time(22) else time(8)
        day_end = end.time() if day_start < end.time() <= time(22) else time(18)
        busy = [
            (datetime.fromisoformat(event["start_utc"]), datetime.fromisoformat(event["end_utc"]))
            for event in self._events()
        ]
        seed = sum(ord(character) for address in attendee_emails for character in address.lower()) % 5
        per_day: list[list[datetime]] = []
        day = start.date()
        while day <= end.date():
            slots = []
            cursor = datetime.combine(day, day_start, zone)
            last = datetime.combine(day, day_end, zone)
            cursor = max(cursor, start)
            if cursor.minute % 30:
                cursor += timedelta(minutes=30 - cursor.minute % 30)
            cursor = cursor.replace(second=0, microsecond=0)
            while cursor + timedelta(minutes=minutes) <= min(last, end):
                index = cursor.toordinal() * 48 + cursor.hour * 2 + cursor.minute // 30
                slot_end = cursor + timedelta(minutes=minutes)
                overlaps = any(
                    cursor.astimezone(timezone.utc) < busy_end and busy_start < slot_end.astimezone(timezone.utc)
                    for busy_start, busy_end in busy
                )
                if (index + seed) % 5 != 2 and not overlaps:
                    if not slots or cursor - slots[-1] >= timedelta(minutes=max(60, minutes)):
                        slots.append(cursor)
                cursor += timedelta(minutes=30)
            if slots:
                per_day.append(slots)
            day += timedelta(days=1)
        picked: list[datetime] = []
        rank = 0
        while len(picked) < max_candidates and any(rank < len(slots) for slots in per_day):
            for slots in per_day:
                if rank < len(slots) and len(picked) < max_candidates:
                    picked.append(slots[rank])
            rank += 1
        suggestions = []
        for slot in sorted(picked):
            slot_end = slot + timedelta(minutes=minutes)
            suggestion: dict[str, Any] = {
                "confidence": 100.0,
                "organizerAvailability": "free",
                "attendeeAvailability": [
                    {"attendee": {"emailAddress": {"address": address}}, "availability": "free"}
                    for address in attendee_emails
                ],
                "meetingTimeSlot": {
                    "end": self._graph_time(slot_end.astimezone(timezone.utc), "UTC"),
                    "start": self._graph_time(slot.astimezone(timezone.utc), "UTC"),
                },
            }
            if return_suggestion_reasons:
                suggestion["suggestionReason"] = "Suggested because everyone is available (mock calendar)."
            suggestions.append(suggestion)
        return self._ok(
            tool,
            meetingTimeSuggestions=suggestions,
            emptySuggestionsReason="" if suggestions else "AttendeesUnavailable",
        )

    def get_user_date_and_time_zone_settings(self) -> dict[str, Any]:
        zone = self._zone(self._user_zone_name)
        now = self._clock().astimezone(zone)
        return self._ok(
            "get_user_date_and_time_zone_settings",
            timeZone=self._user_zone_name,
            currentDateTime=now.strftime("%Y-%m-%dT%H:%M:%S"),
            date=now.date().isoformat(),
            dayOfWeek=WEEKDAYS[now.weekday()],
            workingHours={"daysOfWeek": list(WEEKDAYS[:5]), "startTime": "08:00:00", "endTime": "17:00:00"},
        )

    def create_event(
        self,
        subject: str,
        start_date_time: str,
        end_date_time: str,
        time_zone: str,
        attendee_emails: list[str],
        is_online_meeting: bool,
        body: str,
        location: str,
    ) -> dict[str, Any]:
        tool = "create_event"
        try:
            zone = self._zone(time_zone)
            start = self._local(start_date_time, zone)
            end = self._local(end_date_time, zone)
        except UnknownTimeZone:
            return self._fail(tool, "UNKNOWN_TIME_ZONE", f"Unknown time zone '{time_zone}'.")
        except ValueError as error:
            return self._fail(tool, "INVALID_ARGUMENT", str(error))
        if end <= start or end - start > timedelta(hours=8):
            return self._fail(tool, "INVALID_ARGUMENT", "endDateTime must be after startDateTime and within 8 hours.")
        invalid = [address for address in attendee_emails if not EMAIL.fullmatch(address.strip())]
        if invalid:
            return self._fail(tool, "INVALID_ATTENDEE", f"Not a valid email address: {invalid[0]}")
        event = {
            "id": f"mock-evt-{self._rng.getrandbits(32):08x}",
            "subject": subject.strip(),
            "start_utc": start.astimezone(timezone.utc).isoformat(),
            "end_utc": end.astimezone(timezone.utc).isoformat(),
            "time_zone": time_zone.strip(),
            "attendees": [address.strip() for address in attendee_emails],
            "is_online_meeting": is_online_meeting,
            "location": location.strip(),
            "body": body.strip(),
            "cancelled": False,
        }
        return self._ok(tool, **self._event_view(event))

    def list_calendar_view(
        self,
        start_date_time: str,
        end_date_time: str,
        time_zone: str,
        subject: str,
        top: int,
    ) -> dict[str, Any]:
        tool = "list_calendar_view"
        try:
            zone = self._zone(time_zone)
            start = self._local(start_date_time, zone).astimezone(timezone.utc)
            end = self._local(end_date_time, zone).astimezone(timezone.utc)
        except UnknownTimeZone:
            return self._fail(tool, "UNKNOWN_TIME_ZONE", f"Unknown time zone '{time_zone}'.")
        except ValueError as error:
            return self._fail(tool, "INVALID_ARGUMENT", str(error))
        if end <= start:
            return self._fail(tool, "INVALID_ARGUMENT", "endDateTime must be after startDateTime.")
        needle = subject.strip().lower()
        matches = [
            event for event in self._events()
            if datetime.fromisoformat(event["start_utc"]) < end
            and start < datetime.fromisoformat(event["end_utc"])
            and needle in event["subject"].lower()
        ]
        matches.sort(key=lambda event: event["start_utc"])
        value = [self._event_view(event, time_zone.strip()) for event in matches[:top]]
        return self._ok(tool, value=value, count=len(value))

    def update_event(
        self,
        event_id: str,
        start_date_time: str,
        end_date_time: str,
        time_zone: str,
        subject: str,
        location: str,
    ) -> dict[str, Any]:
        tool = "update_event"
        key = event_id.strip()
        event = self._seed_event(key)
        if event is None:
            if not GENERATED_EVENT_ID.fullmatch(key):
                return self._fail(tool, "EVENT_NOT_FOUND", f"No event with id {event_id}.")
            # An event created earlier in this call; the mock kept nothing, so the new times must be given.
            if not (start_date_time.strip() and end_date_time.strip()):
                return self._fail(
                    tool,
                    "INVALID_ARGUMENT",
                    "Give both startDateTime and endDateTime to move an event created earlier in this call.",
                )
            event = {
                "id": key, "subject": "", "start_utc": "", "end_utc": "",
                "time_zone": self._user_zone_name, "attendees": [], "is_online_meeting": False,
                "location": "", "body": "", "cancelled": False,
            }
        zone_name = time_zone.strip() or event["time_zone"]
        try:
            zone = self._zone(zone_name)
            start = (
                self._local(start_date_time, zone)
                if start_date_time.strip()
                else datetime.fromisoformat(event["start_utc"])
            )
            end = (
                self._local(end_date_time, zone)
                if end_date_time.strip()
                else start + (datetime.fromisoformat(event["end_utc"]) - datetime.fromisoformat(event["start_utc"]))
            )
        except UnknownTimeZone:
            return self._fail(tool, "UNKNOWN_TIME_ZONE", f"Unknown time zone '{time_zone}'.")
        except ValueError as error:
            return self._fail(tool, "INVALID_ARGUMENT", str(error))
        if end <= start:
            return self._fail(tool, "INVALID_ARGUMENT", "endDateTime must be after startDateTime.")
        event.update(
            start_utc=start.astimezone(timezone.utc).isoformat(),
            end_utc=end.astimezone(timezone.utc).isoformat(),
            time_zone=zone_name,
        )
        if subject.strip():
            event["subject"] = subject.strip()
        if location.strip():
            event["location"] = location.strip()
        return self._ok(tool, **self._event_view(event))

    def cancel_event(self, event_id: str, comment: str) -> dict[str, Any]:
        tool = "cancel_event"
        key = event_id.strip()
        event = self._seed_event(key)
        if event is None and not GENERATED_EVENT_ID.fullmatch(key):
            return self._fail(tool, "EVENT_NOT_FOUND", f"No event with id {event_id}.")
        return self._ok(tool, eventId=key, subject=event["subject"] if event else "", cancelled=True)

    # ------------------------------------------------------- presence, mail

    def get_user_presence(self, user_email: str) -> dict[str, Any]:
        tool = "get_user_presence"
        for person in self._fixtures["directory"]:
            if person["email"].lower() == user_email.strip().lower():
                return self._ok(
                    tool,
                    userEmail=person["email"],
                    displayName=person["name"],
                    availability=person["availability"],
                    activity=person["activity"],
                )
        return self._fail(tool, "USER_NOT_FOUND", f"No directory user {user_email}.")

    def send_email_with_attachments(
        self,
        to: list[str],
        subject: str,
        body: str,
        content_type: str,
        cc: list[str],
    ) -> dict[str, Any]:
        tool = "send_email_with_attachments"
        recipients = [address.strip() for address in to if address.strip()]
        invalid = [address for address in [*recipients, *cc] if not EMAIL.fullmatch(address.strip())]
        if not recipients or invalid:
            return self._fail(tool, "INVALID_RECIPIENT", f"Not a valid email address: {(invalid or [''])[0]}")
        message_id = f"mock-mail-{self._rng.getrandbits(32):08x}"
        return self._ok(tool, messageId=message_id, status="sent", to=recipients, subject=subject)

    # ------------------------------------------------------------ salesforce

    def _contacts(self) -> list[dict[str, Any]]:
        return self._fixtures["contacts"]

    def salesforce_search(self, email: str, name: str) -> dict[str, Any]:
        tool = "salesforce_search"
        if email.strip():
            records = [c for c in self._contacts() if c["Email"].lower() == email.strip().lower()]
        elif name.strip():
            records = [c for c in self._contacts() if name.strip().lower() in c["Name"].lower()]
        else:
            return self._fail(tool, "MISSING_QUERY", "Give an email or a name.", source="salesforce", count=0, records=[])
        return self._ok(tool, source="salesforce", count=len(records[:5]), records=records[:5])

    def salesforce_get_contact(self, contact_id: str, email: str) -> dict[str, Any]:
        tool = "salesforce_get_contact"
        if contact_id.strip():
            matches = [c for c in self._contacts() if c["Id"].lower() == contact_id.strip().lower()]
        elif email.strip():
            matches = [c for c in self._contacts() if c["Email"].lower() == email.strip().lower()]
        else:
            return self._fail(tool, "MISSING_QUERY", "Give a contact_id or an email.", source="salesforce", found=False, contact=None)
        return self._ok(tool, source="salesforce", found=bool(matches), contact=matches[0] if matches else None)

    def salesforce_create_lead(self, fields: dict[str, str]) -> dict[str, Any]:
        tool = "salesforce_create_lead"
        email = fields.get("email", "").strip()
        if email and not EMAIL.fullmatch(email):
            return self._fail(tool, "INVALID_EMAIL", f"Not a valid email address: {email}", source="salesforce", lead_id=None)
        lead_id = f"00QMOCK{self._rng.randrange(10**9):09d}"
        return self._ok(tool, source="salesforce", lead_id=lead_id)

    # --------------------------------------------------------------- zendesk

    def _fixture_ticket(self, ticket_id: str) -> dict[str, Any] | None:
        return next((dict(ticket) for ticket in self._fixtures["tickets"] if str(ticket["id"]) == ticket_id), None)

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return {
            token for token in re.split(r"[^a-z0-9]+", text.lower())
            if token and token not in STOP_WORDS and (len(token) > 2 or token.isdigit())
        }

    def zendesk_search(self, query: str, search_type: str) -> dict[str, Any]:
        tool = "zendesk_search"
        if search_type == "tickets":
            if query.strip().lstrip("#").isdigit():
                ticket = self._fixture_ticket(query.strip().lstrip("#"))
                tickets = [ticket] if ticket else []
            else:
                wanted = self._tokens(query)
                tickets = [
                    ticket for ticket in self._fixtures["tickets"]
                    if wanted & self._tokens(f"{ticket['subject']} {ticket.get('description', '')}")
                ]
            results = [
                {
                    "id": ticket["id"],
                    "title": ticket["subject"],
                    "status": ticket["status"],
                    "url": f"https://contoso.zendesk.example.invalid/agent/tickets/{ticket['id']}",
                    "snippet": str(ticket.get("description", ""))[:200],
                }
                for ticket in tickets[:5]
            ]
            return self._ok(tool, source="zendesk", type="tickets", count=len(results), results=results)
        wanted = self._tokens(query)
        lowered = query.lower()
        scored = []
        for article in self._fixtures["articles"]:
            haystack = self._tokens(f"{article['title']} {article['body']} {' '.join(article['labels'])}")
            score = len(wanted & haystack) + sum(2 for label in article["labels"] if label in lowered)
            if score:
                scored.append((score, article))
        scored.sort(key=lambda item: (-item[0], item[1]["id"]))
        results = [
            {
                "id": article["id"],
                "title": article["title"],
                "status": "published",
                "url": f"https://contoso.zendesk.example.invalid/hc/articles/{article['id']}",
                "snippet": article["body"],
            }
            for _, article in scored[:5]
        ]
        return self._ok(tool, source="zendesk", type="articles", count=len(results), results=results)

    def zendesk_add_comment(self, ticket_id: str, comment: str, public: bool) -> dict[str, Any]:
        tool = "zendesk_add_comment"
        key = ticket_id.strip().lstrip("#")
        ticket = self._fixture_ticket(key)
        if ticket is None and not (key.isdigit() and int(key) in GENERATED_TICKET_IDS):
            return self._fail(tool, "TICKET_NOT_FOUND", f"Ticket {ticket_id} does not exist.", source="zendesk", ticket_id=None)
        updated = self._clock().astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        # A comment reopens a solved, pending, or new ticket; nothing is stored.
        status = "open" if ticket is None or ticket["status"] in {"solved", "pending", "new"} else ticket["status"]
        return self._ok(tool, source="zendesk", ticket_id=int(key), status=status, updated_at=updated)

    def zendesk_create_ticket(
        self,
        subject: str,
        description: str,
        requester_name: str,
        requester_email: str,
        priority: str,
    ) -> dict[str, Any]:
        tool = "zendesk_create_ticket"
        if requester_email.strip() and not EMAIL.fullmatch(requester_email.strip()):
            return self._fail(tool, "INVALID_EMAIL", f"Not a valid email address: {requester_email}", source="zendesk", ticket_id=None)
        number = self._rng.choice(GENERATED_TICKET_IDS)
        return self._ok(tool, source="zendesk", ticket_id=number, status="new", priority=priority)

    # ---------------------------------------------------------------- twilio

    def twilio_send_message(self, to: str, body: str) -> dict[str, Any]:
        tool = "twilio_send_message"
        number = re.sub(r"[\s().-]", "", to)
        if not E164.fullmatch(number) or number in self._fixtures["sms"]["failing_numbers"]:
            return self._fail(
                tool,
                "21211",
                f"The 'To' number {to} is not a valid phone number.",
                source="twilio",
                message_sid=None,
                status=None,
            )
        sid = f"SMMOCK{self._rng.randrange(10**26):026d}"
        return self._ok(tool, source="twilio", message_sid=sid, status="queued", to=number)

    # ---------------------------------------------------------------- orders

    def order_lookup(self, order_number: str, email: str) -> dict[str, Any]:
        tool = "order_lookup"
        wanted = order_number.strip().lstrip("#")
        matches = [
            order for order in self._fixtures["orders"]
            if (wanted and order["order_number"] == wanted)
            or (not wanted and email.strip() and order["email"].lower() == email.strip().lower())
        ]
        if not matches:
            return self._fail(tool, "ORDER_NOT_FOUND", "No order matches those details.", order=None)
        if len(matches) > 1:
            # An email alone can match several orders; never pick one silently.
            return self._fail(
                tool, "MULTIPLE_ORDERS", "More than one order uses that email. Ask for the order number.", order=None,
            )
        order = matches[0]
        # With both values, the email verifies the caller before any order detail is returned.
        if wanted and email.strip() and order["email"].lower() != email.strip().lower():
            return self._fail(
                tool, "VERIFICATION_FAILED", "The email does not match the email on that order.", order=None,
            )
        today = self._today()
        view: dict[str, Any] = {
            "order_number": order["order_number"],
            "customer_name": order["customer_name"],
            "status": order["status"],
            "shipping_method": order["shipping_method"],
            "ordered_on": (today - timedelta(days=order["ordered_days_ago"])).isoformat(),
            "items": order["items"],
            "carrier": order["carrier"],
            "tracking_number": order["tracking_number"],
        }
        if order.get("shipped_days_ago") is not None:
            shipped = today - timedelta(days=order["shipped_days_ago"])
            view["shipped_on"] = shipped.isoformat()
            low, high = (3, 5) if order["shipping_method"] == "standard" else (1, 2)
            view["estimated_delivery"] = {
                "earliest": _add_business_days(shipped, low).isoformat(),
                "latest": _add_business_days(shipped, high).isoformat(),
            }
        if order.get("delivered_days_ago") is not None:
            view["delivered_on"] = (today - timedelta(days=order["delivered_days_ago"])).isoformat()
        return self._ok(tool, order=view)

    # -------------------------------------------------------------- products

    @staticmethod
    def _stems(text: str) -> set[str]:
        # Singular and plural forms match ("jackets" finds "jacket").
        return {token[:-1] if len(token) > 3 and token.endswith("s") else token for token in MockToolCallService._tokens(text)}

    @staticmethod
    def _product_view(product: dict[str, Any]) -> dict[str, Any]:
        sizes = list(product.get("sizes") or [])
        in_stock_sizes = list(product.get("sizes_in_stock") or [])
        in_stock = bool(product.get("in_stock", True)) and (not sizes or bool(in_stock_sizes))
        return {
            "product_id": product["product_id"],
            "name": product["name"],
            "category": product["category"],
            "price": product["price"],
            "currency": PRODUCT_CURRENCY,
            "rating": product["rating"],
            "review_count": product["review_count"],
            "in_stock": in_stock,
            "sizes": sizes,
            "sizes_in_stock": in_stock_sizes if in_stock else [],
            "colors": list(product.get("colors") or []),
            "features": list(product.get("features") or []),
            "final_sale": bool(product.get("final_sale", False)),
        }

    def _product(self, product_id: str) -> dict[str, Any] | None:
        wanted = product_id.strip().upper()
        return next((product for product in self._fixtures["products"] if product["product_id"] == wanted), None)

    def product_search(
        self,
        query: str,
        category: str,
        max_price: float,
        in_stock_only: bool,
        limit: int,
    ) -> dict[str, Any]:
        tool = "product_search"
        if not query.strip() and not category.strip():
            return self._fail(tool, "INVALID_QUERY", "Give search words or a category.", count=0, results=[])
        wanted_category = category.strip().lower()

        def passes_filters(product: dict[str, Any], view: dict[str, Any]) -> bool:
            if wanted_category and wanted_category not in product["category"].lower():
                return False
            if max_price > 0 and view["price"] > max_price:
                return False
            return not (in_stock_only and not view["in_stock"])

        exact = self._product(query) if query.strip() else None
        if exact is not None:
            # An exact product ID still honours category, max_price, and in_stock_only.
            view = self._product_view(exact)
            results = [view] if passes_filters(exact, view) else []
            return self._ok(tool, source="catalog", count=len(results), total_matches=len(results), results=results)
        wanted = self._stems(query)
        scored = []
        for product in self._fixtures["products"]:
            if wanted_category and wanted_category not in product["category"].lower():
                continue
            haystack = self._stems(
                f"{product['name']} {product['category']} {' '.join(product.get('features', []))} "
                f"{' '.join(product.get('tags', []))}"
            )
            score = len(wanted & haystack)
            # A query whose words are all too short or stop words (such as "TV") matches nothing.
            if query.strip() and not score:
                continue
            view = self._product_view(product)
            if not passes_filters(product, view):
                continue
            scored.append((score, view))
        scored.sort(key=lambda item: (-item[0], -item[1]["rating"], item[1]["product_id"]))
        results = [view for _, view in scored[:limit]]
        return self._ok(tool, source="catalog", count=len(results), total_matches=len(scored), results=results)

    def cart_add_item(self, product_id: str, quantity: int, size: str) -> dict[str, Any]:
        tool = "cart_add_item"
        product = self._product(product_id)
        if product is None:
            return self._fail(tool, "PRODUCT_NOT_FOUND", f"No product has the ID {product_id}.", cart_id=None)
        view = self._product_view(product)
        if not view["in_stock"]:
            return self._fail(tool, "OUT_OF_STOCK", f"{view['name']} is out of stock.", cart_id=None)
        chosen = size.strip().upper()
        if view["sizes"] and not chosen:
            return self._fail(
                tool, "SIZE_REQUIRED", f"Choose a size: {', '.join(view['sizes_in_stock'])}.", cart_id=None,
            )
        if view["sizes"] and chosen not in view["sizes_in_stock"]:
            return self._fail(
                tool, "SIZE_UNAVAILABLE", f"Size {size} is not in stock; in stock: {', '.join(view['sizes_in_stock'])}.",
                cart_id=None,
            )
        cart_id = f"CART-{_base36(self._rng.randrange(36**6)).rjust(6, '0')}"
        line = {
            "product_id": view["product_id"],
            "name": view["name"],
            "size": chosen if view["sizes"] else None,
            "quantity": quantity,
            "unit_price": view["price"],
            "line_total": round(view["price"] * quantity, 2),
            "currency": PRODUCT_CURRENCY,
        }
        return self._ok(tool, source="cart", cart_id=cart_id, status="added", line=line)

    # ----------------------------------------------------------------- hotel

    def _rooms(self, guests: int, room_type: str) -> list[dict[str, Any]]:
        return [
            room for room in self._fixtures["hotel"]["rooms"]
            if room["sleeps"] >= guests
            and (not room_type.strip() or room_type.strip().lower() in room["room_type"].lower())
        ]

    @staticmethod
    def _nights(check_in: str, check_out: str) -> tuple[date, date, int]:
        start = date.fromisoformat(check_in.strip())
        end = date.fromisoformat(check_out.strip())
        nights = (end - start).days
        if not 1 <= nights <= 30:
            raise ValueError("check_out must be 1 to 30 nights after check_in.")
        return start, end, nights

    def _room_available(self, room: dict[str, Any], start: date, nights: int) -> bool:
        sold_out = set(room.get("sold_out_nights") or [])
        return not any(WEEKDAYS[(start + timedelta(days=n)).weekday()] in sold_out for n in range(nights))

    def hotel_check_availability(self, check_in: str, check_out: str, guests: int, room_type: str) -> dict[str, Any]:
        tool = "hotel_check_availability"
        try:
            start, end, nights = self._nights(check_in, check_out)
        except ValueError as error:
            return self._fail(tool, "INVALID_DATES", str(error), rooms=[])
        if start < self._today():
            return self._fail(tool, "INVALID_DATES", "check_in is in the past.", rooms=[])
        rooms = [
            {
                "room_type": room["room_type"],
                "sleeps": room["sleeps"],
                "available": self._room_available(room, start, nights),
                "nightly_rate": room["nightly_rate"],
                "total_before_taxes": room["nightly_rate"] * nights,
            }
            for room in self._rooms(guests, room_type)
        ]
        return self._ok(tool, check_in=start.isoformat(), check_out=end.isoformat(), nights=nights, guests=guests, rooms=rooms)

    def _reservation(self, confirmation_number: str) -> dict[str, Any] | None:
        """A fixture reservation; reservations created by callers are never stored."""
        key = confirmation_number.strip().upper()
        for seed in self._fixtures["hotel"]["reservations"]:
            if seed["confirmation_number"] == key:
                arrival = self._today() + timedelta(days=seed["arrival_days_from_today"])
                room = next(r for r in self._fixtures["hotel"]["rooms"] if r["room_type"] == seed["room_type"])
                return {
                    "confirmation_number": key,
                    "first_name": seed["first_name"],
                    "last_name": seed["last_name"],
                    "email": "",
                    "room_type": seed["room_type"],
                    "check_in": arrival.isoformat(),
                    "check_out": (arrival + timedelta(days=seed["nights"])).isoformat(),
                    "guests": seed["guests"],
                    "nightly_rate": room["nightly_rate"],
                    "total_before_taxes": room["nightly_rate"] * seed["nights"],
                    "package": "",
                    "status": "confirmed",
                }
        return None

    def hotel_create_reservation(
        self,
        first_name: str,
        last_name: str,
        email: str,
        room_type: str,
        check_in: str,
        check_out: str,
        guests: int,
        package: str,
    ) -> dict[str, Any]:
        tool = "hotel_create_reservation"
        if not EMAIL.fullmatch(email.strip()):
            return self._fail(tool, "INVALID_EMAIL", f"Not a valid email address: {email}", confirmation_number=None)
        try:
            start, end, nights = self._nights(check_in, check_out)
        except ValueError as error:
            return self._fail(tool, "INVALID_DATES", str(error), confirmation_number=None)
        rooms = self._rooms(guests, room_type)
        if not rooms:
            return self._fail(tool, "ROOM_NOT_FOUND", f"No {room_type} room sleeps {guests}.", confirmation_number=None)
        room = rooms[0]
        if not self._room_available(room, start, nights):
            return self._fail(tool, "SOLD_OUT", f"{room['room_type']} is sold out for those nights.", confirmation_number=None)
        code = "M" + _base36(self._rng.randrange(36**5)).rjust(5, "0")
        document = {
            "confirmation_number": code,
            "first_name": first_name.strip(),
            "last_name": last_name.strip(),
            "email": email.strip(),
            "room_type": room["room_type"],
            "check_in": start.isoformat(),
            "check_out": end.isoformat(),
            "guests": guests,
            "nightly_rate": room["nightly_rate"],
            "total_before_taxes": room["nightly_rate"] * nights,
            "package": package.strip(),
            "status": "confirmed",
        }
        return self._ok(tool, **document)

    def hotel_get_reservation(self, confirmation_number: str, last_name: str) -> dict[str, Any]:
        tool = "hotel_get_reservation"
        reservation = self._reservation(confirmation_number)
        if reservation is None or reservation["last_name"].lower() != last_name.strip().lower():
            return self._fail(tool, "RESERVATION_NOT_FOUND", "No reservation matches that confirmation number and last name.", reservation=None)
        return self._ok(tool, reservation=reservation)

    def hotel_cancel_reservation(self, confirmation_number: str, last_name: str) -> dict[str, Any]:
        tool = "hotel_cancel_reservation"
        reservation = self._reservation(confirmation_number)
        if reservation is None or reservation["last_name"].lower() != last_name.strip().lower():
            return self._fail(tool, "RESERVATION_NOT_FOUND", "No reservation matches that confirmation number and last name.")
        arrival = datetime.combine(date.fromisoformat(reservation["check_in"]), time(15), self._zone(self._user_zone_name))
        fee_applies = arrival - self._clock() < timedelta(hours=48)
        return self._ok(
            tool,
            confirmation_number=reservation["confirmation_number"],
            status="cancelled",
            cancellation_fee=reservation["nightly_rate"] if fee_applies else 0,
        )

    # ------------------------------------------------------------ restaurant

    def _dining_today(self) -> dict[str, str]:
        """Today's local date, returned with every availability and booking result so a relative day can be checked."""
        today = self._today()
        return {"today": today.isoformat(), "today_weekday": WEEKDAYS[today.weekday()]}

    def _dining_date(self, value: str) -> date:
        """A bookable local date; raises ValueError with the reason otherwise."""
        restaurant = self._fixtures["restaurant"]
        day = date.fromisoformat(value.strip())
        today = self._today()
        if day < today:
            raise ValueError("date is in the past.")
        if day > today + timedelta(days=restaurant["booking_window_days"]):
            raise ValueError(f"Reservations open {restaurant['booking_window_days']} days ahead.")
        return day

    @staticmethod
    def _clock_time(value: str) -> str:
        """Normalizes 19:00, 7:00 PM, or 7 pm to HH:MM; raises ValueError otherwise."""
        match = DINING_TIME.fullmatch(value.strip())
        if not match:
            raise ValueError(f"time must look like 19:00 or 7:00 PM, not {value!r}.")
        hour, minute, meridiem = int(match.group(1)), int(match.group(2) or 0), (match.group(3) or "").lower()
        if meridiem:
            if not 1 <= hour <= 12:
                raise ValueError(f"Not a valid time: {value}")
            hour = hour % 12 + (12 if meridiem.startswith("p") else 0)
        if hour > 23 or minute > 59:
            raise ValueError(f"Not a valid time: {value}")
        return f"{hour:02d}:{minute:02d}"

    def _seating_area(self, seating: str, party_size: int) -> str:
        """The matching seating area name; raises ValueError when it can't seat the party."""
        restaurant = self._fixtures["restaurant"]
        if party_size > restaurant["max_party_size"]:
            raise LargeParty(
                f"Parties larger than {restaurant['max_party_size']} are booked by the events team, not online."
            )
        wanted = seating.strip().lower()
        if not wanted:
            return restaurant["seating"][0]["area"]
        area = next((a for a in restaurant["seating"] if wanted in a["area"] or a["area"] in wanted), None)
        if area is None:
            names = ", ".join(a["area"] for a in restaurant["seating"])
            raise ValueError(f"Unknown seating area {seating!r}; choose one of: {names}.")
        if party_size > area["max_party_size"]:
            raise ValueError(f"The {area['area']} seats parties of up to {area['max_party_size']}.")
        return area["area"]

    def _open_times(self, day: date) -> list[str]:
        """Seating times still bookable on a day, every slot_minutes from first to last seating."""
        restaurant = self._fixtures["restaurant"]
        weekday = WEEKDAYS[day.weekday()]
        hours = restaurant["service_hours"].get(weekday)
        if not hours:
            return []
        full = {t for rule in restaurant["fully_booked"] if rule["weekday"] == weekday for t in rule["times"]}
        current = datetime.combine(day, time.fromisoformat(hours[0]))
        last = datetime.combine(day, time.fromisoformat(hours[1]))
        now = self._clock().astimezone(self._zone(self._user_zone_name)).replace(tzinfo=None)
        times = []
        while current <= last:
            label = current.strftime("%H:%M")
            if label not in full and current > now:
                times.append(label)
            current += timedelta(minutes=restaurant["slot_minutes"])
        return times

    @staticmethod
    def _nearest(times: list[str], wanted: str, count: int = 4) -> list[str]:
        minutes = int(wanted[:2]) * 60 + int(wanted[3:])
        ranked = sorted(times, key=lambda t: (abs(int(t[:2]) * 60 + int(t[3:]) - minutes), t))
        return sorted(ranked[:count])

    def restaurant_check_availability(self, day: str, at: str, party_size: int, seating: str) -> dict[str, Any]:
        tool = "restaurant_check_availability"
        today = self._dining_today()
        try:
            booking_day = self._dining_date(day)
            wanted = self._clock_time(at)
            area = self._seating_area(seating, party_size)
        except LargeParty as error:
            return self._fail(tool, "LARGE_PARTY", str(error), **today, available_times=[])
        except ValueError as error:
            return self._fail(tool, "INVALID_REQUEST", str(error), **today, available_times=[])
        weekday = WEEKDAYS[booking_day.weekday()]
        hours = self._fixtures["restaurant"]["service_hours"].get(weekday)
        if not hours:
            return self._fail(tool, "CLOSED", f"The restaurant is closed on {weekday}s.", **today, available_times=[])
        times = self._open_times(booking_day)
        return self._ok(
            tool,
            **today,
            date=booking_day.isoformat(),
            weekday=weekday,
            party_size=party_size,
            seating=area,
            first_seating=hours[0],
            last_seating=hours[1],
            requested_time=wanted,
            requested_time_available=wanted in times,
            available_times=self._nearest(times, wanted),
        )

    def restaurant_create_reservation(
        self,
        first_name: str,
        last_name: str,
        phone: str,
        day: str,
        at: str,
        party_size: int,
        seating: str,
        occasion: str,
        special_requests: str,
    ) -> dict[str, Any]:
        tool = "restaurant_create_reservation"
        today = self._dining_today()
        number = re.sub(r"[\s().-]", "", phone)
        if not E164.fullmatch(number):
            return self._fail(tool, "INVALID_PHONE", f"Phone must be in E.164 format, such as +14255550142, not {phone}.", **today, confirmation_number=None)
        try:
            booking_day = self._dining_date(day)
            wanted = self._clock_time(at)
            area = self._seating_area(seating, party_size)
        except LargeParty as error:
            return self._fail(tool, "LARGE_PARTY", str(error), **today, confirmation_number=None)
        except ValueError as error:
            return self._fail(tool, "INVALID_REQUEST", str(error), **today, confirmation_number=None)
        times = self._open_times(booking_day)
        if wanted not in times:
            return self._fail(
                tool, "TIME_UNAVAILABLE", f"{wanted} on {booking_day.isoformat()} is not available.", **today,
                confirmation_number=None, available_times=self._nearest(times, wanted),
            )
        code = "R" + _base36(self._rng.randrange(36**5)).rjust(5, "0")
        return self._ok(
            tool,
            confirmation_number=code,
            status="confirmed",
            **today,
            first_name=first_name.strip(),
            last_name=last_name.strip(),
            phone=number,
            date=booking_day.isoformat(),
            weekday=WEEKDAYS[booking_day.weekday()],
            time=wanted,
            party_size=party_size,
            seating=area,
            occasion=occasion.strip(),
            special_requests=special_requests.strip(),
        )

    def _dining_reservation(self, confirmation_number: str, last_name: str) -> dict[str, Any] | None:
        """A fixture reservation matching both values; reservations created by callers are never stored."""
        key = confirmation_number.strip().upper()
        for seed in self._fixtures["restaurant"]["reservations"]:
            if seed["confirmation_number"] == key and seed["last_name"].lower() == last_name.strip().lower():
                day = self._today() + timedelta(days=seed["days_from_today"])
                return {
                    "confirmation_number": key,
                    "first_name": seed["first_name"],
                    "last_name": seed["last_name"],
                    "phone": seed["phone"],
                    "date": day.isoformat(),
                    "weekday": WEEKDAYS[day.weekday()],
                    "time": seed["time"],
                    "party_size": seed["party_size"],
                    "seating": seed["seating"],
                    "occasion": seed["occasion"],
                    "special_requests": seed["special_requests"],
                    "status": "confirmed",
                }
        return None

    def restaurant_get_reservation(self, confirmation_number: str, last_name: str) -> dict[str, Any]:
        tool = "restaurant_get_reservation"
        reservation = self._dining_reservation(confirmation_number, last_name)
        if reservation is None:
            return self._fail(tool, "RESERVATION_NOT_FOUND", "No reservation matches that confirmation number and last name.", reservation=None)
        return self._ok(tool, reservation=reservation)

    def restaurant_cancel_reservation(self, confirmation_number: str, last_name: str) -> dict[str, Any]:
        tool = "restaurant_cancel_reservation"
        reservation = self._dining_reservation(confirmation_number, last_name)
        if reservation is None:
            return self._fail(tool, "RESERVATION_NOT_FOUND", "No reservation matches that confirmation number and last name.")
        return self._ok(tool, confirmation_number=reservation["confirmation_number"], status="cancelled")

    # ------------------------------------------------------------ shared ids

    def _today_fields(self) -> dict[str, str]:
        today = self._today()
        return {"today": today.isoformat(), "today_weekday": WEEKDAYS[today.weekday()]}

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}-{self._rng.randrange(10000, 100000)}"

    def _day(self, offset: int | None) -> str | None:
        return None if offset is None else (self._today() + timedelta(days=offset)).isoformat()

    # ------------------------------------------------------------ membership

    def _plan(self, plan_id: str) -> dict[str, Any]:
        return next(p for p in self._fixtures["memberships"]["plans"] if p["plan_id"] == plan_id)

    def _member(self, member_id: str, email: str, card_last4: str) -> tuple[dict[str, Any] | None, str | None]:
        """The member matching the identifier AND the card's last four digits, else a failure code that never says which part failed."""
        members = self._fixtures["memberships"]["members"]
        wanted_id = re.sub(r"[^0-9A-Z]", "", member_id.upper())
        if wanted_id.isdigit():
            wanted_id = "M" + wanted_id
        wanted_email = email.strip().lower()
        if not wanted_id and not wanted_email:
            raise ValueError("Give the member_id or the account email, plus card_last4.")
        by_id = next((m for m in members if m["member_id"].replace("-", "") == wanted_id), None) if wanted_id else None
        by_email = next((m for m in members if m["email"].lower() == wanted_email), None) if wanted_email else None
        member = by_id or by_email
        if member is None:
            return None, "NOT_FOUND"
        if wanted_id and wanted_email and by_id is not by_email:
            return None, "VERIFICATION_FAILED"
        if re.sub(r"\D", "", card_last4) != member["card_last4"]:
            return None, "VERIFICATION_FAILED"
        return member, None

    def _member_failure(self, tool: str, code: str) -> dict[str, Any]:
        message = "No membership matches those details." if code == "NOT_FOUND" else "Those details don't match a membership."
        return self._fail(tool, code, message, **self._today_fields())

    def _period_end(self, member: dict[str, Any]) -> int:
        if member["status"] == "pending_cancel":
            return member["cancel_effective_days"]
        if member["status"] == "cancelled":
            return -member["cancelled_days_ago"]
        return member["next_billing_days"] - 1

    def _pause_block(self, member: dict[str, Any]) -> tuple[str, str] | None:
        status = member["status"]
        if status == "paused":
            return "ALREADY_PAUSED", f"The membership is already paused until {self._day(member['next_billing_days'])}."
        if status in ("cancelled", "pending_cancel"):
            return "NOT_ACTIVE", "The membership is not active."
        if status == "past_due":
            return "PAST_DUE", "The membership has a past-due balance; it must be paid in the app first."
        if self._plan(member["plan_id"])["billing_cycle"] == "annual":
            return "PAUSE_NOT_ELIGIBLE", "Annual plans can't be paused."
        used = member.get("pause_used_days_ago")
        if used is not None and used < 365:
            return "PAUSE_NOT_ELIGIBLE", "A pause was already used in the last 12 months."
        return None

    def _offers(self, member: dict[str, Any]) -> list[dict[str, Any]]:
        offers = {o["offer_id"]: o for o in self._fixtures["memberships"]["offers"]}
        return [offers[offer_id] for offer_id in member["eligible_offer_ids"]]

    def _member_view(self, member: dict[str, Any]) -> dict[str, Any]:
        plan = self._plan(member["plan_id"])
        status = member["status"]
        view: dict[str, Any] = {
            "member_id": member["member_id"],
            "first_name": member["first_name"],
            "plan_id": plan["plan_id"],
            "plan_name": plan["plan_name"],
            "billing_cycle": plan["billing_cycle"],
            "price_usd": plan["price_usd"],
            "status": status,
            "next_billing_date": self._day(member["next_billing_days"]),
            "current_period_end": self._day(self._period_end(member)),
            "paused_until": self._day(member["next_billing_days"]) if status == "paused" else None,
            "member_since": self._day(-member["member_since_days_ago"]),
            "card_last4": member["card_last4"],
            "pause_options": [] if self._pause_block(member) else [1, 2, 3],
            "eligible_offers": [
                {key: offer[key] for key in ("offer_id", "kind", "description", "months", "price_usd")}
                for offer in self._offers(member)
            ],
        }
        if status == "past_due":
            view["payment_failed_on"] = self._day(-member["payment_failed_days_ago"])
            view["amount_due_usd"] = plan["price_usd"]
        if status == "cancelled":
            view["cancelled_on"] = self._day(-member["cancelled_days_ago"])
        if status == "pending_cancel":
            view["cancellation_effective_date"] = self._day(member["cancel_effective_days"])
        return view

    def membership_lookup(self, member_id: str, email: str, card_last4: str) -> dict[str, Any]:
        tool = "membership_lookup"
        member, code = self._member(member_id, email, card_last4)
        if member is None:
            return self._member_failure(tool, code or "NOT_FOUND")
        return self._ok(tool, **self._today_fields(), member=self._member_view(member))

    def membership_change_plan(self, member_id: str, card_last4: str, new_plan_id: str) -> dict[str, Any]:
        tool = "membership_change_plan"
        member, code = self._member(member_id, "", card_last4)
        if member is None:
            return self._member_failure(tool, code or "NOT_FOUND")
        today = self._today_fields()
        current, target = self._plan(member["plan_id"]), self._plan(new_plan_id)
        if member["status"] in ("cancelled", "pending_cancel"):
            return self._fail(tool, "NOT_ACTIVE", "The membership is not active.", **today)
        if member["status"] == "past_due":
            return self._fail(tool, "PAST_DUE", "The membership has a past-due balance; it must be paid in the app first.", **today)
        if current["plan_id"] == target["plan_id"]:
            return self._fail(tool, "SAME_PLAN", f"The member is already on {current['plan_name']}.", **today)
        if current["billing_cycle"] == "annual":
            return self._fail(
                tool, "PLAN_NOT_AVAILABLE",
                f"An annual plan can change only when it renews on {self._day(member['next_billing_days'])}.", **today,
            )
        return self._ok(
            tool, **today, change_id=self._new_id("CHG"), previous_plan_name=current["plan_name"],
            new_plan_id=target["plan_id"], new_plan_name=target["plan_name"], new_price_usd=target["price_usd"],
            billing_cycle=target["billing_cycle"], effective_date=self._day(member["next_billing_days"]),
        )

    def membership_pause(self, member_id: str, card_last4: str, months: int) -> dict[str, Any]:
        tool = "membership_pause"
        member, code = self._member(member_id, "", card_last4)
        if member is None:
            return self._member_failure(tool, code or "NOT_FOUND")
        today = self._today_fields()
        blocked = self._pause_block(member)
        if blocked:
            return self._fail(tool, blocked[0], blocked[1], **today)
        start = self._today() + timedelta(days=member["next_billing_days"])
        return self._ok(
            tool, **today, pause_id=self._new_id("PSE"), months=months, pause_start=start.isoformat(),
            resume_date=_add_months(start, months).isoformat(), charge_during_pause_usd=0.0,
        )

    def membership_apply_retention_offer(self, member_id: str, card_last4: str, offer_id: str) -> dict[str, Any]:
        tool = "membership_apply_retention_offer"
        member, code = self._member(member_id, "", card_last4)
        if member is None:
            return self._member_failure(tool, code or "NOT_FOUND")
        today = self._today_fields()
        if member["status"] in ("cancelled", "pending_cancel"):
            return self._fail(tool, "NOT_ACTIVE", "The membership is not active.", **today)
        offer = next((o for o in self._offers(member) if o["offer_id"] == offer_id.strip().upper()), None)
        if offer is None:
            return self._fail(tool, "OFFER_NOT_ELIGIBLE", "That offer is not available for this membership.", **today)
        effective = self._today() + timedelta(days=member["next_billing_days"])
        ends_on = _add_months(effective, offer["months"]) - timedelta(days=1) if offer["months"] else None
        return self._ok(
            tool, **today, applied=True, offer_id=offer["offer_id"], kind=offer["kind"],
            description=offer["description"], new_price_usd=offer["price_usd"], effective_date=effective.isoformat(),
            ends_on=ends_on.isoformat() if ends_on else None,
        )

    def membership_cancel(self, member_id: str, card_last4: str, reason: str, note: str) -> dict[str, Any]:
        tool = "membership_cancel"
        member, code = self._member(member_id, "", card_last4)
        if member is None:
            return self._member_failure(tool, code or "NOT_FOUND")
        today = self._today_fields()
        if member["status"] == "cancelled":
            return self._fail(
                tool, "ALREADY_CANCELLED", "The membership is already cancelled.", **today,
                cancelled_on=self._day(-member["cancelled_days_ago"]),
            )
        if member["status"] == "pending_cancel":
            effective = self._day(member["cancel_effective_days"])
            return self._fail(
                tool, "PENDING_CANCEL", f"A cancellation is already scheduled for {effective}.", **today,
                effective_date=effective,
            )
        end = self._day(self._period_end(member))
        return self._ok(
            tool, **today, cancellation_id=self._new_id("CXL"), reason=reason, effective_date=end,
            access_until=end, renewal_stopped=True,
        )

    # ------------------------------------------------------------- shipments

    def _parcel(self, tracking_number: str) -> dict[str, Any] | None:
        key = re.sub(r"[^0-9A-Z]", "", tracking_number.upper())
        return next((p for p in self._fixtures["shipments"]["parcels"] if p["tracking_number"] == key), None)

    @staticmethod
    def _postal_matches(parcel: dict[str, Any], postal_code: str) -> bool:
        return re.sub(r"\D", "", postal_code)[:5] == parcel["postal_code"]

    def _now_local(self) -> datetime:
        return self._clock().astimezone(self._zone(self._user_zone_name))

    def _delivery_days(self, count: int) -> list[date]:
        """The next `count` delivery days (Monday to Saturday) after today."""
        days, current = [], self._today()
        while len(days) < count:
            current += timedelta(days=1)
            if current.weekday() != 6:
                days.append(current)
        return days

    def _moment(self, event: dict[str, Any]) -> datetime:
        if "hours_ago" in event:
            return (self._now_local() - timedelta(hours=event["hours_ago"])).replace(second=0, microsecond=0)
        day = self._today() - timedelta(days=event["days_ago"])
        return datetime.combine(day, time.fromisoformat(event["time"]), self._now_local().tzinfo)

    def _area_points(self, parcel: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {key: point[key] for key in ("pickup_point_id", "name", "hours")}
            for point in self._fixtures["shipments"]["pickup_points"] if point["postal_code"] == parcel["postal_code"]
        ]

    def _parcel_view(self, parcel: dict[str, Any], verified: bool) -> dict[str, Any]:
        config = self._fixtures["shipments"]
        last = self._moment(parcel["last_event"])
        window = parcel["delivery_window"]
        view: dict[str, Any] = {
            "tracking_number": parcel["tracking_number"],
            "carrier": config["carrier"],
            "status": parcel["status"],
            "status_detail": parcel["status_detail"],
            "exception_code": parcel["exception_code"],
            "last_event": {"date": last.date().isoformat(), "time": last.strftime("%H:%M"), "city": parcel["last_event"]["city"]},
            "estimated_delivery_date": self._day(parcel["estimated_delivery_days"]),
            "delivery_window": {"start": window[0], "end": window[1]} if window else None,
            "signature_required": parcel["signature_required"],
            "redelivery_eligible": parcel["status"] == "delivery_attempted",
            "sender_allows_changes": parcel["changes_allowed"],
            "address_verified": verified,
        }
        if not verified:
            return view
        if parcel.get("delivered"):
            moment = self._moment(parcel["delivered"])
            trace_from = moment + timedelta(hours=config["trace_after_hours"])
            view["delivered"] = {
                "date": moment.date().isoformat(),
                "time": moment.strftime("%H:%M"),
                "location": parcel["delivered"]["location"],
                "photo_available": parcel["delivered"]["photo_available"],
                "trace_eligible": self._now_local() >= trace_from,
                "trace_available_from": {"date": trace_from.date().isoformat(), "time": trace_from.strftime("%H:%M")},
            }
        if parcel["status"] == "delivery_attempted":
            view["redelivery_dates"] = [d.isoformat() for d in self._delivery_days(config["redelivery_days"])]
            view["redelivery_window"] = {"start": config["redelivery_window"][0], "end": config["redelivery_window"][1]}
        if parcel["status"] == "held_at_pickup_point":
            view["pickup_points"] = [p for p in self._area_points(parcel) if p["pickup_point_id"] == parcel["held_at"]]
            view["hold_until"] = self._day(parcel["hold_until_days"])
        elif parcel["status"] not in ("delivered", "returned_to_sender"):
            view["pickup_points"] = self._area_points(parcel)
        return view

    def _parcel_for_change(self, tool: str, tracking_number: str, postal_code: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        parcel = self._parcel(tracking_number)
        if parcel is None:
            return None, self._fail(tool, "NOT_FOUND", "No shipment matches that tracking number.", **self._today_fields())
        if not self._postal_matches(parcel, postal_code):
            return None, self._fail(
                tool, "POSTAL_CODE_MISMATCH", "Those details don't match the shipment.", **self._today_fields(),
            )
        return parcel, None

    def shipment_track(self, tracking_number: str, postal_code: str) -> dict[str, Any]:
        tool = "shipment_track"
        parcel = self._parcel(tracking_number)
        if parcel is None:
            return self._fail(tool, "NOT_FOUND", "No shipment matches that tracking number.", **self._today_fields(), shipment=None)
        verified = False
        if postal_code.strip():
            if not self._postal_matches(parcel, postal_code):
                return self._fail(
                    tool, "POSTAL_CODE_MISMATCH", "Those details don't match the shipment.", **self._today_fields(),
                    shipment=None,
                )
            verified = True
        return self._ok(tool, **self._today_fields(), shipment=self._parcel_view(parcel, verified))

    def shipment_schedule_redelivery(self, tracking_number: str, postal_code: str, day: str) -> dict[str, Any]:
        tool = "shipment_schedule_redelivery"
        parcel, failure = self._parcel_for_change(tool, tracking_number, postal_code)
        if failure:
            return failure
        today = self._today_fields()
        if parcel["status"] != "delivery_attempted":
            reason = {
                "delivered": "delivered", "returned_to_sender": "returned", "held_at_pickup_point": "held",
            }.get(parcel["status"], "not_attempted")
            return self._fail(tool, "NOT_ELIGIBLE", "Redelivery is only for a missed delivery attempt.", **today, reason=reason)
        config = self._fixtures["shipments"]
        dates = self._delivery_days(config["redelivery_days"])
        available = [d.isoformat() for d in dates]
        try:
            wanted = date.fromisoformat(day.strip())
        except ValueError:
            wanted = None
        if wanted not in dates:
            message = "We don't deliver on Sundays." if wanted and wanted.weekday() == 6 else (
                f"Redelivery is possible on the next {config['redelivery_days']} delivery days."
            )
            return self._fail(tool, "DATE_UNAVAILABLE", message, **today, available_dates=available)
        return self._ok(
            tool, **today, redelivery_id=self._new_id("RD"), tracking_number=parcel["tracking_number"],
            date=wanted.isoformat(), weekday=WEEKDAYS[wanted.weekday()],
            window={"start": config["redelivery_window"][0], "end": config["redelivery_window"][1]},
            signature_required=parcel["signature_required"],
        )

    def shipment_update_delivery(
        self,
        tracking_number: str,
        postal_code: str,
        action: str,
        instructions: str,
        pickup_point_id: str,
        unit: str,
    ) -> dict[str, Any]:
        tool = "shipment_update_delivery"
        parcel, failure = self._parcel_for_change(tool, tracking_number, postal_code)
        if failure:
            return failure
        today = self._today_fields()
        status = parcel["status"]
        if status == "delivered":
            return self._fail(tool, "ALREADY_DELIVERED", "The parcel was already delivered.", **today)
        if status == "returned_to_sender":
            return self._fail(tool, "TOO_LATE", "The parcel was returned to the sender.", **today)
        if not parcel["changes_allowed"]:
            return self._fail(tool, "NOT_ALLOWED_BY_SENDER", "The sender doesn't allow delivery changes for this parcel.", **today)
        if status == "held_at_pickup_point":
            return self._fail(tool, "TOO_LATE", "The parcel is already held at a pickup point.", **today)
        if status == "out_for_delivery" and action != "add_instructions":
            return self._fail(
                tool, "TOO_LATE", "The parcel is out for delivery; only delivery instructions can be added now.", **today,
            )
        change: dict[str, Any] = {"change_id": self._new_id("DC"), "action": action, "applies_to": "next delivery attempt"}
        if action == "add_instructions":
            if not instructions.strip():
                raise ValueError("instructions are required for add_instructions.")
            change["summary"] = f"Delivery instructions added: {instructions.strip()}"
        elif action == "correct_unit":
            if not unit.strip():
                raise ValueError("unit is required for correct_unit.")
            change["summary"] = f"Apartment or unit {unit.strip()} added to the delivery address."
        else:
            wanted = pickup_point_id.strip().lower()
            point = next(
                (p for p in self._area_points(parcel)
                 if wanted and (p["pickup_point_id"].lower() == wanted or wanted in p["name"].lower())),
                None,
            )
            if point is None:
                return self._fail(
                    tool, "PICKUP_POINT_NOT_FOUND", "That pickup point isn't available for this parcel.", **today,
                    pickup_points=self._area_points(parcel),
                )
            ready = self._delivery_days(1)[0]
            change.update(
                summary=f"Held at {point['name']}.", applies_to="hold at pickup point", pickup_point=point,
                available_from=ready.isoformat(),
                hold_until=(ready + timedelta(days=self._fixtures["shipments"]["hold_days"])).isoformat(),
            )
        return self._ok(tool, **today, tracking_number=parcel["tracking_number"], **change)

    # -------------------------------------------------------------- pharmacy

    def _prescription(self, rx_number: str, last_name: str, date_of_birth: str) -> tuple[dict[str, Any] | None, str | None]:
        """The prescription only when the Rx number, last name, and date of birth all match; never says which part failed."""
        config = self._fixtures["pharmacy"]
        rx = next((r for r in config["prescriptions"] if r["rx_number"] == re.sub(r"\D", "", rx_number)), None)
        if rx is None:
            return None, "NOT_FOUND"
        patient = next(p for p in config["patients"] if p["last_name"] == rx["last_name"])
        try:
            birth = date.fromisoformat(date_of_birth.strip()).isoformat()
        except ValueError:
            birth = ""
        if last_name.strip().lower() != patient["last_name"].lower() or birth != patient["date_of_birth"]:
            return None, "VERIFICATION_FAILED"
        return {**rx, "patient_first_name": patient["first_name"]}, None

    def _rx_failure(self, tool: str, code: str) -> dict[str, Any]:
        message = "No prescription matches that number." if code == "NOT_FOUND" else "Those details don't match a prescription."
        return self._fail(tool, code, message, **self._today_fields())

    def _ready_by(self) -> dict[str, str]:
        """When a refill queued now is ready: before the cutoff in a few hours, otherwise the next day at a fixed time."""
        config = self._fixtures["pharmacy"]
        now = self._now_local().replace(second=0, microsecond=0)
        hours = config["hours"][WEEKDAYS[now.weekday()]]
        opens = datetime.combine(now.date(), time.fromisoformat(hours[0]), now.tzinfo)
        closes = datetime.combine(now.date(), time.fromisoformat(hours[1]), now.tzinfo)
        cutoff = datetime.combine(now.date(), time.fromisoformat(config["same_day_cutoff"]), now.tzinfo)
        ready = None
        if now < cutoff:
            ready = max(now, opens) + timedelta(hours=config["ready_hours"])
            ready += timedelta(minutes=(30 - ready.minute % 30) % 30)
            if ready > closes:
                ready = None
        if ready is None:
            ready = datetime.combine(now.date() + timedelta(days=1), time.fromisoformat(config["next_day_ready"]), now.tzinfo)
        return {"date": ready.date().isoformat(), "weekday": WEEKDAYS[ready.weekday()], "time": ready.strftime("%H:%M")}

    def _earliest_refill(self, rx: dict[str, Any]) -> date:
        fraction = self._fixtures["pharmacy"]["refill_after_fraction"]
        last_fill = self._today() - timedelta(days=rx["last_fill_days_ago"])
        return last_fill + timedelta(days=math.ceil(rx["days_supply"] * fraction))

    def _refill_block(self, rx: dict[str, Any]) -> tuple[str, str] | None:
        if rx["status"] == "transferred":
            return "TRANSFERRED_OUT", "This prescription was transferred to another pharmacy."
        if rx["status"] == "expired":
            return "PRESCRIPTION_EXPIRED", "This prescription has expired; the prescriber must renew it."
        if rx["controlled_schedule"] == "II":
            return "CONTROLLED_SUBSTANCE", "Schedule II prescriptions can't be refilled; the prescriber must send a new prescription."
        if rx.get("in_progress_refill"):
            return "ALREADY_IN_PROGRESS", "A refill for this prescription is already in progress."
        if rx["refills_remaining"] <= 0:
            return "NO_REFILLS_LEFT", "No refills are left on this prescription."
        if self._earliest_refill(rx) > self._today():
            return "TOO_SOON", "It's too soon to refill this prescription."
        return None

    def _rx_view(self, rx: dict[str, Any]) -> dict[str, Any]:
        blocked = self._refill_block(rx)
        in_progress = rx.get("in_progress_refill")
        view = {
            "rx_number": rx["rx_number"],
            "patient_first_name": rx["patient_first_name"],
            "drug_name": rx["drug_name"],
            "strength": rx["strength"],
            "form": rx["form"],
            "quantity": rx["quantity"],
            "days_supply": rx["days_supply"],
            "refills_remaining": rx["refills_remaining"],
            "last_fill_date": self._day(-rx["last_fill_days_ago"]),
            "earliest_refill_date": self._earliest_refill(rx).isoformat(),
            "status": rx["status"],
            "expired_on": self._day(-rx["expired_days_ago"]) if rx.get("expired_days_ago") is not None else None,
            "controlled_schedule": rx["controlled_schedule"],
            "prescriber_name": rx["prescriber_name"],
            "in_progress_refill": {"refill_id": in_progress["refill_id"], "ready_by": self._ready_by()} if in_progress else None,
            "pending_renewal": rx.get("pending_renewal"),
            "can_refill_now": blocked is None,
            "refill_blocked_reason": blocked[0] if blocked else None,
        }
        return view

    def pharmacy_rx_lookup(self, rx_number: str, last_name: str, date_of_birth: str) -> dict[str, Any]:
        tool = "pharmacy_rx_lookup"
        rx, code = self._prescription(rx_number, last_name, date_of_birth)
        if rx is None:
            return self._rx_failure(tool, code or "NOT_FOUND")
        return self._ok(tool, **self._today_fields(), rx=self._rx_view(rx), store=self._fixtures["pharmacy"]["store"])

    def pharmacy_refill_submit(self, rx_number: str, last_name: str, date_of_birth: str, pickup_date: str) -> dict[str, Any]:
        tool = "pharmacy_refill_submit"
        rx, code = self._prescription(rx_number, last_name, date_of_birth)
        if rx is None:
            return self._rx_failure(tool, code or "NOT_FOUND")
        today = self._today_fields()
        if pickup_date.strip():
            wanted = date.fromisoformat(pickup_date.strip())
            if wanted < self._today():
                raise ValueError("pickup_date is in the past.")
        blocked = self._refill_block(rx)
        if blocked:
            extra: dict[str, Any] = {}
            if blocked[0] == "TOO_SOON":
                extra["earliest_refill_date"] = self._earliest_refill(rx).isoformat()
            if blocked[0] == "ALREADY_IN_PROGRESS":
                extra.update(refill_id=rx["in_progress_refill"]["refill_id"], ready_by=self._ready_by())
            if blocked[0] in ("NO_REFILLS_LEFT", "PRESCRIPTION_EXPIRED", "CONTROLLED_SUBSTANCE"):
                extra["prescriber_name"] = rx["prescriber_name"]
            return self._fail(tool, blocked[0], blocked[1], **today, **extra)
        store = self._fixtures["pharmacy"]["store"]
        return self._ok(
            tool, **today, refill_id=self._new_id("RF"), rx_number=rx["rx_number"], ready_by=self._ready_by(),
            pickup_date=pickup_date.strip() or None, pickup_location=f"{store['name']}, {store['address']}",
            refills_remaining_after=rx["refills_remaining"] - 1,
        )

    def pharmacy_renewal_request(self, rx_number: str, last_name: str, date_of_birth: str, note: str) -> dict[str, Any]:
        tool = "pharmacy_renewal_request"
        rx, code = self._prescription(rx_number, last_name, date_of_birth)
        if rx is None:
            return self._rx_failure(tool, code or "NOT_FOUND")
        today = self._today_fields()
        if rx["status"] == "transferred":
            return self._fail(tool, "TRANSFERRED_OUT", "This prescription was transferred to another pharmacy.", **today)
        if rx.get("pending_renewal"):
            return self._fail(
                tool, "RENEWAL_ALREADY_PENDING", "A renewal request was already sent to the prescriber.", **today,
                renewal_id=rx["pending_renewal"]["renewal_id"], prescriber_name=rx["prescriber_name"],
            )
        if rx["status"] == "active" and rx["controlled_schedule"] != "II" and rx["refills_remaining"] > 0:
            return self._fail(tool, "REFILLS_REMAIN", "Refills are left on this prescription; request a refill instead.", **today)
        return self._ok(
            tool, **today, renewal_id=self._new_id("RN"), rx_number=rx["rx_number"],
            prescriber_name=rx["prescriber_name"], sent_via="electronic", typical_response_business_days=2,
        )

    # ------------------------------------------------- coaching and research

    def _record(self, tool: str, prefix: str) -> dict[str, Any]:
        """Acknowledge a record write with a generated ID; the record itself is not stored."""
        return self._ok(tool, record_id=f"{prefix}-{self._rng.randrange(1000, 10000)}", saved=True)

    def quiz_record_result(
        self,
        quiz_name: str,
        participant_name: str,
        score: int,
        total: int,
        passing_score: int,
        missed_questions: list[int],
    ) -> dict[str, Any]:
        tool = "quiz_record_result"
        if score > total or passing_score > total:
            return self._fail(tool, "INVALID_SCORE", "score and passing_score cannot exceed total.")
        result = self._record(tool, "QR")
        return {**result, "passed": score >= passing_score, "score": score, "total": total}

    def training_record_session(
        self,
        scenario: str,
        participant_name: str,
        scores: dict[str, int],
        key_takeaway: str,
    ) -> dict[str, Any]:
        return self._record("training_record_session", "TS")

    def research_save_interview_notes(
        self,
        consent_given: bool,
        participant_name: str,
        summary: str,
        ratings: dict[str, int],
    ) -> dict[str, Any]:
        tool = "research_save_interview_notes"
        if not consent_given:
            return self._fail(tool, "CONSENT_REQUIRED", "Notes are saved only with the participant's consent.")
        return self._record(tool, "RN")


class UnknownTimeZone(ValueError):
    pass


class LargeParty(ValueError):
    pass


def _add_business_days(start: date, days: int) -> date:
    current = start
    while days:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days -= 1
    return current


def _add_months(start: date, months: int) -> date:
    month = start.month - 1 + months
    year, month = start.year + month // 12, month % 12 + 1
    days = [31, 29 if year % 4 == 0 and (year % 100 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return date(year, month, min(start.day, days[month - 1]))


def _base36(number: int) -> str:
    digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    text = ""
    while True:
        number, remainder = divmod(number, 36)
        text = digits[remainder] + text
        if not number:
            return text


def load_fixtures(path: Path = FIXTURES_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != 1:
        raise ValueError("mock-tool-call fixtures.json must have version 1")
    return payload
