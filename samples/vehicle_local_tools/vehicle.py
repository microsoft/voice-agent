"""Allowlisted vehicle tools backed by local, in-memory cockpit state."""

from __future__ import annotations

import json
import math
import re
import sys
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any
from tool_contracts import COMMANDS, LOCAL_TOOLS, PHONE_CONTACTS, definitions, validate

SEARCH_TOOL = "search_vehicle_tools"
DOOR_NAMES = ("front_left", "front_right", "rear_left", "rear_right")
SEARCH_TAGS = {
    "get_vehicle_status": "read current status state settings overview cabin temperature media volume navigation destination door doors window windows hood trunk",
    "set_cabin_temperature": "climate cabin temperature heat heating warm warmer cool cooler cooling air conditioning ac celsius",
    "set_media_volume": "media music audio sound volume louder quieter loud quiet mute stereo",
    "start_navigation": "navigate navigation directions destination route map address travel go drive library",
    "set_vehicle_doors": "door doors open close shut passenger driver front rear left right all",
    "set_vehicle_windows": "glass window windows lower raise up down open close passenger front rear left right all",
    "set_vehicle_lid": "hood bonnet frunk front trunk boot rear cargo lid compartment open close",
}


def configure_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def search_tool() -> dict[str, Any]:
    return {
        "type": "function", "name": SEARCH_TOOL,
        "description": (
            "Search the local vehicle tool catalog for the requested action. "
            "Return up to three matching function definitions. "
            "Search on every new user turn before a vehicle tool call."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 200}},
            "required": ["query"], "additionalProperties": False,
        },
    }


def search(query: str, available: frozenset[str]) -> list[dict[str, Any]]:
    if (
        not isinstance(query, str) or not query.strip() or len(query) > 200
        or any(ord(character) < 32 or ord(character) == 127 for character in query)
    ):
        raise ToolRejected("query must be 1 to 200 characters without control characters.")
    terms = set(re.findall(r"[a-z0-9]+", query.lower())) - {
        "a", "an", "the", "to", "of", "and", "my", "me", "please", "tool", "tools",
        "set", "get", "can", "you", "i", "want", "use", "with", "for",
    }
    ranked = []
    catalog = {tool["name"]: tool for tool in [*tools(), *legacy_tools()]}
    for tool in catalog.values():
        if tool["name"] not in available:
            continue
        fields = [
            (tool["name"].replace("_", " "), 4),
            (SEARCH_TAGS.get(tool["name"], ""), 3),
            (tool["description"], 1),
        ]
        score = sum(len(terms & set(re.findall(r"[a-z0-9]+", text.lower()))) * weight for text, weight in fields)
        if score:
            ranked.append((score, tool))
    ranked.sort(key=lambda item: (-item[0], item[1]["name"]))
    return [tool for _score, tool in ranked[:3]]


def tools() -> list[dict[str, Any]]:
    return definitions()


def legacy_tools() -> list[dict[str, Any]]:
    specifications = [
        ("get_vehicle_status", "Read local cockpit settings and the state of doors, windows, and compartments. No hardware telemetry is available.", {}),
        ("set_cabin_temperature", "Set the local cabin temperature setting from 16 to 30 degrees Celsius. No climate hardware is connected.", {
            "temperature_c": {"type": "number", "minimum": 16, "maximum": 30},
        }),
        ("set_media_volume", "Set the local media volume setting from 0 to 60 percent. No media playback service is connected.", {
            "volume_percent": {"type": "integer", "minimum": 0, "maximum": 60},
        }),
        ("start_navigation", "Store destination text in the local cockpit. This tool does not calculate a route or an arrival time.", {
            "destination": {"type": "string", "minLength": 1, "maxLength": 200},
        }),
        ("set_vehicle_doors", "Open or close one or all passenger doors on the 3D vehicle model. Does not unlock doors or control vehicle hardware.", {
            "door": {"type": "string", "enum": ["all", *DOOR_NAMES]},
            "is_open": {"type": "boolean"},
        }),
        ("set_vehicle_windows", "Lower or raise passenger glass on the 3D vehicle model. Use is_open=true to lower glass. Use is_open=false to raise glass.", {
            "window": {"type": "string", "enum": ["all", *DOOR_NAMES]},
            "is_open": {"type": "boolean"},
        }),
        ("set_vehicle_lid", "Open or close a compartment on the 3D vehicle model. Use lid=hood for the front hood. Use lid=trunk for the rear trunk.", {
            "lid": {"type": "string", "enum": ["hood", "trunk"]},
            "is_open": {"type": "boolean"},
        }),
    ]
    return [{
        "type": "function",
        "name": name,
        "description": description,
        "parameters": {
            "type": "object", "properties": properties,
            "required": list(properties), "additionalProperties": False,
        },
    } for name, description, properties in specifications]


class ToolRejected(ValueError):
    """A local policy or argument validation rejection."""


@dataclass
class LocalVehicle:
    temperature_c: float = 21.0
    volume_percent: int = 20
    destination: str | None = None
    stops: list[str] = field(default_factory=list)
    doors: dict[str, bool] = field(default_factory=lambda: dict.fromkeys(DOOR_NAMES, False))
    windows: dict[str, bool] = field(default_factory=lambda: dict.fromkeys(DOOR_NAMES, False))
    lids: dict[str, bool] = field(default_factory=lambda: {"hood": False, "trunk": False})
    revision: int = 0
    climate: dict[str, Any] = field(default_factory=lambda: {
        "fan": 3, "power": True, "ac": True, "auto": True, "recirculation": False, "defrost": False,
    })
    navigation: dict[str, Any] = field(default_factory=lambda: {"avoid_tolls": False, "avoid_highways": False})
    cluster: dict[str, Any] = field(default_factory=lambda: {
        "units": "metric", "theme": "dark", "layout": "standard", "brightness": 80,
    })
    assist: dict[str, Any] = field(default_factory=lambda: {"detail": "brief", "tips": True, "hardware_available": None})
    phone: dict[str, Any] = field(default_factory=lambda: {
        "notifications": True, "detail": "brief", "connected": False, "calling_available": False,
        "available": False, "contacts": list(PHONE_CONTACTS), "call_state": "idle", "contact": None,
        "direction": None, "muted": False, "duration_seconds": 0, "rev": 0, "reason": None,
    })

    def domains(self) -> dict[str, dict[str, Any]]:
        return deepcopy({
            "climate": {**self.climate, "temperature_c": self.temperature_c},
            "media": {"volume_percent": self.volume_percent, "available": False},
            "navigation": {**self.navigation, "destination": self.destination,
                           "stops": self.stops or ([self.destination] if self.destination else [])},
            "cluster": self.cluster, "assist": self.assist, "phone": self.phone,
            "body": {"doors": self.doors, "windows": self.windows, "lids": self.lids},
            "autopilot": {"available": False, "reason": "No owning browser control channel."},
        })

    def command(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            validate(name, arguments)
        except ValueError as error:
            raise ToolRejected(str(error)) from error
        if name not in LOCAL_TOOLS:
            raise ToolRejected("UNAVAILABLE: This command needs its external provider.")
        if name == "read_vehicle":
            domain = arguments["domain"]
            domains = self.domains()
            value = domains if domain == "all" else domains[domain]
            if "fields" in arguments:
                if set(arguments["fields"]) - value.keys():
                    raise ToolRejected("UNAVAILABLE: Requested fields have no confirmed value.")
                value = {key: value[key] for key in arguments["fields"]}
            return {"ok": True, "rev": self.revision, "scope": "local_cockpit", "data": value}
        args = dict(arguments)
        if name.startswith("set_vehicle_") or name == "set_media_volume":
            result = self.execute(name, args)
            domain = "media" if name == "set_media_volume" else "body"
            if domain == "media":
                changed = args
            else:
                key = {"set_vehicle_doors": "doors", "set_vehicle_windows": "windows", "set_vehicle_lid": "lids"}[name]
                changed = {key: result["state"][key]}
            return {"ok": True, "rev": self.revision, "scope": "local_cockpit", "changed": {domain: changed}}
        if name == "set_climate":
            if "temperature_c" in args:
                self.temperature_c = float(args["temperature_c"])
            self.climate.update({k: v for k, v in args.items() if k != "temperature_c"})
            domain = "climate"
        elif name in {"set_destination", "clear_destination", "edit_itinerary"}:
            stops = list(self.domains()["navigation"]["stops"])
            if name == "set_destination":
                stops = [args["destination"].strip()]
            elif name == "clear_destination":
                stops = []
            elif args["action"] == "append":
                if len(stops) >= 8:
                    raise ToolRejected("OUT_OF_RANGE: An itinerary supports up to eight stops. Remove a stop first.")
                stops.append(args["destination"].strip())
            else:
                if args["index"] >= len(stops):
                    raise ToolRejected("OUT_OF_RANGE: That itinerary stop no longer exists. Read navigation and retry.")
                if args["action"] == "update":
                    stops[args["index"]] = args["destination"].strip()
                else:
                    stops.pop(args["index"])
            self.stops = stops
            self.destination = stops[0] if stops else None
            args = {"destination": self.destination, "stops": list(stops)}
            domain = "navigation"
        else:
            domain = name.removeprefix("set_").removesuffix("_preferences")
            getattr(self, domain).update(args)
        self.revision += 1
        return {"ok": True, "rev": self.revision, "scope": "local_cockpit", "changed": {domain: args}}

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name in COMMANDS and name not in {"set_media_volume", "set_vehicle_doors", "set_vehicle_windows", "set_vehicle_lid"}:
            return self.command(name, arguments)
        expected = {
            "get_vehicle_status": set(),
            "set_cabin_temperature": {"temperature_c"},
            "set_media_volume": {"volume_percent"},
            "start_navigation": {"destination"},
            "set_vehicle_doors": {"door", "is_open"},
            "set_vehicle_windows": {"window", "is_open"},
            "set_vehicle_lid": {"lid", "is_open"},
        }
        if name not in expected:
            raise ToolRejected("This function is not permitted by the local vehicle.")
        if set(arguments) != expected[name]:
            raise ToolRejected("Arguments must match the local tool contract exactly.")
        if name == "set_cabin_temperature":
            value = arguments["temperature_c"]
            if type(value) not in (int, float) or not 16 <= value <= 30 or not math.isfinite(value):
                raise ToolRejected("temperature_c must be a finite number from 16 to 30.")
            self.temperature_c = float(value)
        elif name == "set_media_volume":
            value = arguments["volume_percent"]
            if type(value) is not int or not 0 <= value <= 60:
                raise ToolRejected("volume_percent must be an integer from 0 to 60.")
            self.volume_percent = value
        elif name == "start_navigation":
            value = arguments["destination"]
            if (
                not isinstance(value, str) or not value.strip() or len(value) > 200
                or any(ord(character) < 32 or ord(character) == 127 for character in value)
            ):
                raise ToolRejected("destination must be 1 to 200 characters without control characters.")
            self.destination = value.strip()
            self.stops = [self.destination]
        elif name in {"set_vehicle_doors", "set_vehicle_windows", "set_vehicle_lid"}:
            selector = {"set_vehicle_doors": "door", "set_vehicle_windows": "window", "set_vehicle_lid": "lid"}[name]
            selected_part = arguments[selector]
            is_open = arguments["is_open"]
            permitted = ("hood", "trunk") if name == "set_vehicle_lid" else ("all", *DOOR_NAMES)
            if not isinstance(selected_part, str) or selected_part not in permitted:
                raise ToolRejected(f"{selector} must be one of: {', '.join(permitted)}.")
            if type(is_open) is not bool:
                raise ToolRejected("is_open must be a boolean.")
            target = {"set_vehicle_doors": self.doors, "set_vehicle_windows": self.windows, "set_vehicle_lid": self.lids}[name]
            for selected in DOOR_NAMES if selected_part == "all" else (selected_part,):
                target[selected] = is_open
        if name != "get_vehicle_status":
            self.revision += 1
        return {
            "ok": True, "execution_scope": "local_cockpit",
            "state": {
                "temperature_c": self.temperature_c,
                "volume_percent": self.volume_percent,
                "destination": self.destination,
                "doors": dict(self.doors),
                "windows": dict(self.windows),
                "lids": dict(self.lids),
            },
        }


def parse_arguments(raw: str) -> dict[str, Any]:
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ToolRejected("Duplicate argument keys are not permitted.")
            result[key] = value
        return result

    def reject_constant(_value):
        raise ToolRejected("Non-finite JSON numbers are not permitted.")

    if not isinstance(raw, str) or len(raw) > 4096:
        raise ToolRejected("Tool arguments must be a JSON object of at most 4096 characters.")
    try:
        arguments = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (json.JSONDecodeError, RecursionError) as error:
        raise ToolRejected("Tool arguments are not valid JSON.") from error
    if not isinstance(arguments, dict):
        raise ToolRejected("Tool arguments must be an object.")
    return arguments


@dataclass
class Dispatcher:
    vehicle: LocalVehicle = field(default_factory=LocalVehicle)
    completed: dict[str, tuple[str, str, dict[str, Any]]] = field(default_factory=dict)
    discovery: bool = False
    available: frozenset[str] = field(default_factory=lambda: LOCAL_TOOLS | frozenset(SEARCH_TAGS))
    discovered: list[str] = field(default_factory=list)

    async def dispatch_async(self, call: dict[str, Any], *, cancelled: bool = False) -> dict[str, Any]:
        return self.dispatch(call, cancelled=cancelled)

    def response_tools(self) -> list[dict[str, Any]]:
        if not self.discovery:
            return definitions(self.available)
        selected = self.discovered if self.discovery else self.available
        return [search_tool(), *[tool for tool in legacy_tools() if tool["name"] in selected and tool["name"] in self.available]]

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == SEARCH_TOOL:
            if set(arguments) != {"query"}:
                raise ToolRejected("Search requires exactly one query argument.")
            matches = search(arguments["query"], self.available)
            for match in matches:
                if match["name"] in self.discovered:
                    self.discovered.remove(match["name"])
                self.discovered.append(match["name"])
            self.discovered = self.discovered[-12:]
            return {
                "ok": True, "execution_scope": "local_cockpit", "matches": matches,
                "instruction": (
                    "Matching tools are now available for the next response. Choose the "
                    "appropriate tool and validate any ambiguous user intent."
                    if matches else
                    "No local capabilities match. Explain that this capability is unavailable "
                    "or ask for clarification. Do not invent a tool or claim an action."
                ),
            }
        if name not in self.available:
            raise ToolRejected("This function is not available on the local vehicle.")
        if self.discovery and name not in self.discovered:
            raise ToolRejected("Search for this capability before executing it.")
        if name in COMMANDS and not self.discovery:
            return self.vehicle.command(name, arguments)
        return self.vehicle.execute(name, arguments)

    def dispatch(self, call: dict[str, Any], *, cancelled: bool = False) -> dict[str, Any]:
        call_id, name, raw = call.get("call_id"), call.get("name"), call.get("arguments")
        if not isinstance(call_id, str) or not call_id or len(call_id) > 256:
            raise RuntimeError("A completed tool call must contain a valid call_id.")
        if not isinstance(name, str) or not isinstance(raw, str):
            raise RuntimeError("A completed tool call must contain a name and JSON arguments.")
        if call_id in self.completed:
            previous_name, previous_raw, result = self.completed[call_id]
            if (name, raw) != (previous_name, previous_raw):
                raise RuntimeError("A call_id was reused with different tool arguments.")
            return result
        if len(self.completed) >= 1000:
            raise RuntimeError("Session reached 1000 tool calls. Start a new session.")
        try:
            result = (
                {"ok": False, "execution_scope": "local_cockpit", "cancelled": True, "error": "Interrupted before local execution."}
                if cancelled else self.execute(name, parse_arguments(raw))
            )
        except ToolRejected as error:
            result = {"ok": False, "execution_scope": "local_cockpit", "error": str(error)}
        self.completed[call_id] = (name, raw, result)
        print(f"Local tool {name}: {'ok' if result['ok'] else result['error']}")
        return result
