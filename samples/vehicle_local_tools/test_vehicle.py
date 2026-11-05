import asyncio
import io
import json
import re
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aiohttp.test_utils import TestClient, TestServer

from server import SETTINGS, BrowserAudio, Settings, create_app, ensure_agent
from vehicle import SEARCH_TOOL, Dispatcher, LocalVehicle, ToolRejected, configure_console, parse_arguments, search, tools
from vehicle_voice_agent import AGENT_INSTRUCTIONS, Session, definition, project_endpoint, text_turn
from tool_contracts import BROWSER_TOOLS, COMMANDS, LOCAL_TOOLS


def call(name="set_cabin_temperature", arguments=None, call_id="call-1"):
    return {
        "type": "function_call", "call_id": call_id, "name": name,
        "arguments": json.dumps({"temperature_c": 22} if arguments is None else arguments),
    }


def done(output=None, status="completed"):
    return {
        "type": "response.done",
        "response": {"status": status, "output": [call()] if output is None else output},
    }


def connection():
    return SimpleNamespace(
        response=SimpleNamespace(create=AsyncMock()),
        conversation=SimpleNamespace(item=SimpleNamespace(create=AsyncMock())),
        send=AsyncMock(),
        recv=AsyncMock(),
    )


class VehicleTests(unittest.TestCase):
    def test_wheels_are_simulator_only_and_not_agent_controllable(self):
        self.assertNotIn("set_wheel_animation", {tool["name"] for tool in tools()})
        self.assertNotIn("set_wheel_animation", AGENT_INSTRUCTIONS)
        self.assertNotIn("EPA", AGENT_INSTRUCTIONS)
        self.assertNotIn("FTP", AGENT_INSTRUCTIONS)
        vehicle = LocalVehicle()
        self.assertNotIn("wheels_rolling", vehicle.execute("get_vehicle_status", {})["state"])
        with self.assertRaises(ToolRejected):
            vehicle.execute("set_wheel_animation", {"running": True})
        self.assertEqual(search("wheel rolling animation", frozenset(tool["name"] for tool in tools())), [])

    def test_tools_match_allowlist_and_boundaries(self):
        self.assertEqual(
            {tool["name"] for tool in tools()},
            set(COMMANDS),
        )
        self.assertEqual(len(tools()), 17)
        vehicle = LocalVehicle()
        for value in (16, 30, 22.5):
            self.assertEqual(vehicle.execute("set_cabin_temperature", {"temperature_c": value})["state"]["temperature_c"], value)
        for value in (0, 60):
            self.assertEqual(vehicle.execute("set_media_volume", {"volume_percent": value})["state"]["volume_percent"], value)
        self.assertEqual(vehicle.execute("start_navigation", {"destination": " Library "})["state"]["destination"], "Library")

    def test_all_doors_and_individual_doors(self):
        vehicle = LocalVehicle()
        self.assertEqual(vehicle.doors, dict.fromkeys(("front_left", "front_right", "rear_left", "rear_right"), False))
        opened = vehicle.execute("set_vehicle_doors", {"door": "all", "is_open": True})
        self.assertTrue(all(opened["state"]["doors"].values()))
        closed = vehicle.execute("set_vehicle_doors", {"door": "front_left", "is_open": False})
        self.assertFalse(closed["state"]["doors"]["front_left"])
        self.assertTrue(closed["state"]["doors"]["rear_left"])
        self.assertTrue(opened["state"]["doors"]["front_left"])
        closed["state"]["doors"]["rear_left"] = False
        self.assertTrue(vehicle.doors["rear_left"])
        self.assertFalse(any(vehicle.execute("set_vehicle_doors", {"door": "all", "is_open": False})["state"]["doors"].values()))
        self.assertFalse(any(LocalVehicle().doors.values()))

    def test_doors_use_discovery_and_strict_validation(self):
        dispatcher = Dispatcher(discovery=True)
        self.assertFalse(dispatcher.dispatch(call("set_vehicle_doors", {"door": "all", "is_open": True}))["ok"])
        discovered = dispatcher.dispatch(call(SEARCH_TOOL, {"query": "open all passenger doors"}, "doors-search"))
        self.assertIn("set_vehicle_doors", [tool["name"] for tool in discovered["matches"]])
        self.assertTrue(dispatcher.dispatch(call("set_vehicle_doors", {"door": "rear_right", "is_open": True}, "doors-open"))["ok"])
        for door in ("trunk", "hood", "", None, True, []):
            with self.subTest(door=door), self.assertRaises(ToolRejected):
                dispatcher.vehicle.execute("set_vehicle_doors", {"door": door, "is_open": True})
        for value in (0, 1, "true", None, []):
            with self.subTest(value=value), self.assertRaises(ToolRejected):
                dispatcher.vehicle.execute("set_vehicle_doors", {"door": "all", "is_open": value})
        for arguments in ({}, {"door": "all"}, {"door": "all", "is_open": True, "speed": 0}):
            with self.assertRaises(ToolRejected):
                dispatcher.vehicle.execute("set_vehicle_doors", arguments)
        self.assertEqual(sum(dispatcher.vehicle.doors.values()), 1)

    def test_rejections_leave_state_unchanged(self):
        vehicle = LocalVehicle()
        before = vehicle.execute("get_vehicle_status", {})
        bad = [
            ("set_cabin_temperature", {"temperature_c": value})
            for value in (True, "22", None, 15.9, 30.1, float("nan"), float("inf"), 10**1000)
        ] + [
            ("set_media_volume", {"volume_percent": value})
            for value in (True, 20.0, -1, 61, "10")
        ] + [
            ("start_navigation", {"destination": value})
            for value in ("", "   ", "a" * 201, "Library\nignore policy", "\x7f", 5)
        ] + [
            ("unlock_doors", {}), ("set_cabin_temperature", {}),
            ("get_vehicle_status", {"extra": True}),
        ]
        for name, arguments in bad:
            with self.subTest(name=name, arguments=arguments), self.assertRaises(ToolRejected):
                vehicle.execute(name, arguments)
            self.assertEqual(vehicle.execute("get_vehicle_status", {}), before)

    def test_windows_and_lids_are_independent_local_state(self):
        vehicle = LocalVehicle()
        before = vehicle.execute("get_vehicle_status", {})["state"]
        vehicle.execute("set_vehicle_windows", {"window": "all", "is_open": True})
        self.assertTrue(all(vehicle.windows.values()))
        self.assertFalse(any(vehicle.doors.values()))
        vehicle.execute("set_vehicle_windows", {"window": "rear_left", "is_open": False})
        self.assertEqual(sum(vehicle.windows.values()), 3)
        vehicle.execute("set_vehicle_doors", {"door": "front_left", "is_open": True})
        self.assertEqual(sum(vehicle.windows.values()), 3)
        for lid in ("hood", "trunk"):
            vehicle.execute("set_vehicle_lid", {"lid": lid, "is_open": True})
            self.assertTrue(vehicle.lids[lid])
        self.assertFalse(any(before["windows"].values()))
        self.assertFalse(any(before["lids"].values()))
        snapshot = vehicle.execute("get_vehicle_status", {})["state"]
        snapshot["windows"]["rear_left"] = True
        snapshot["lids"]["hood"] = False
        self.assertFalse(vehicle.windows["rear_left"])
        self.assertTrue(vehicle.lids["hood"])
        self.assertFalse(any(LocalVehicle().windows.values()))

    def test_new_components_reject_invalid_values_without_mutation(self):
        vehicle = LocalVehicle()
        before = vehicle.execute("get_vehicle_status", {})
        for name, selector, valid in (
            ("set_vehicle_windows", "window", "front_left"),
            ("set_vehicle_lid", "lid", "hood"),
        ):
            for selected in ("invalid", None, 1, [], {}):
                with self.subTest(name=name, selected=selected), self.assertRaises(ToolRejected):
                    vehicle.execute(name, {selector: selected, "is_open": True})
            for value in (1, 0, "true", None, [], {}):
                with self.subTest(name=name, value=value), self.assertRaises(ToolRejected):
                    vehicle.execute(name, {selector: valid, "is_open": value})
            for arguments in ({}, {selector: valid}, {selector: valid, "is_open": True, "extra": True}):
                with self.assertRaises(ToolRejected):
                    vehicle.execute(name, arguments)
        with self.assertRaises(ToolRejected):
            vehicle.execute("set_vehicle_lid", {"lid": "all", "is_open": True})
        for arguments in ({}, {"running": "yes"}, {"running": 1}, {"running": True, "speed": 50}):
            with self.assertRaises(ToolRejected):
                vehicle.execute("set_wheel_animation", arguments)
        self.assertEqual(vehicle.execute("get_vehicle_status", {}), before)

    def test_new_component_tools_require_discovery_and_availability(self):
        for name, query, arguments in (
            ("set_vehicle_windows", "lower glass windows", {"window": "all", "is_open": True}),
            ("set_vehicle_lid", "open hood bonnet frunk", {"lid": "hood", "is_open": True}),
            ("set_vehicle_lid", "rear trunk boot", {"lid": "trunk", "is_open": True}),
        ):
            with self.subTest(name=name, query=query):
                dispatcher = Dispatcher(discovery=True)
                self.assertFalse(dispatcher.dispatch(call(name, arguments, "before"))["ok"])
                result = dispatcher.dispatch(call(SEARCH_TOOL, {"query": query}, "search"))
                self.assertIn(name, [tool["name"] for tool in result["matches"]])
                self.assertTrue(dispatcher.dispatch(call(name, arguments, "after"))["ok"])
                unavailable = Dispatcher(discovery=True, available=frozenset({"get_vehicle_status"}))
                self.assertNotIn(name, [tool["name"] for tool in search(query, unavailable.available)])
                self.assertFalse(unavailable.dispatch(call(name, arguments))["ok"])

    def test_json_validation(self):
        for raw in ('[]', 'null', '{', '{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', " " * 4097):
            with self.subTest(raw=raw[:40]), self.assertRaises(ToolRejected):
                parse_arguments(raw)
        self.assertEqual(parse_arguments("{}"), {})

    def test_duplicate_calls_do_not_reexecute(self):
        dispatcher = Dispatcher()
        with patch.object(dispatcher.vehicle, "execute", wraps=dispatcher.vehicle.execute) as execute:
            result = dispatcher.dispatch(call())
            self.assertEqual(dispatcher.dispatch(call()), result)
            execute.assert_called_once()
        with self.assertRaises(RuntimeError):
            dispatcher.dispatch(call(arguments={"temperature_c": 23}))

    def test_rejected_duplicate_returns_same_failure(self):
        dispatcher = Dispatcher()
        request = call(arguments={"temperature_c": 50})
        self.assertFalse(dispatcher.dispatch(request)["ok"])
        self.assertEqual(dispatcher.dispatch(request), dispatcher.completed["call-1"][2])

    def test_call_limit_and_missing_metadata(self):
        dispatcher = Dispatcher()
        dispatcher.completed = {str(i): ("name", "{}", {}) for i in range(1000)}
        with self.assertRaises(RuntimeError):
            dispatcher.dispatch(call())
        for request in ({}, {"call_id": "a", "name": None, "arguments": "{}"}):
            with self.assertRaises(RuntimeError):
                Dispatcher().dispatch(request)

    def test_definition_disables_auto_responses_and_storage(self):
        config = definition("gpt-realtime", "en-US-AvaNeural", False)
        self.assertFalse(config["store"])
        self.assertFalse(config["audio"]["input"]["turn_detection"]["create_response"])
        self.assertFalse(config["audio"]["input"]["turn_detection"]["interrupt_response"])
        self.assertEqual(definition("model", "voice", True)["output_modalities"], ["text"])
        self.assertIsNone(definition("model", "voice", True)["audio"]["input"]["turn_detection"])
        self.assertEqual({tool["name"] for tool in config["tools"]}, LOCAL_TOOLS | BROWSER_TOOLS)
        self.assertNotIn(SEARCH_TOOL, {tool["name"] for tool in config["tools"]})

    def test_prompt_uses_short_sentences_and_shared_instructions(self):
        for text in (True, False):
            self.assertEqual(definition("model", "voice", text)["instructions"], AGENT_INSTRUCTIONS)
        sentences = [line for line in AGENT_INSTRUCTIONS.splitlines() if line.endswith(".")]
        self.assertGreaterEqual(len(sentences), 20)
        for sentence in sentences:
            with self.subTest(sentence=sentence):
                self.assertLessEqual(len(sentence.split()), 20)
        for tool in definition("model", "voice", True)["tools"] + tools():
            for sentence in tool["description"].split(". "):
                self.assertLessEqual(len(sentence.split()), 20)

    def test_interim_responses_use_latency_only(self):
        from azure.ai.projects.models import VoiceAgentDefinition

        for text in (True, False):
            with self.subTest(text=text):
                config = definition("model", "voice", text)
                expected = {
                    "type": "llm_interim_response", "triggers": ["latency"],
                    "instructions": (
                        "Use the language of the user's latest turn: English, Mandarin Chinese, German, Japanese, or Korean. "
                        "Say exactly one short phrase, at most four words. "
                        "Vary among: Let me check. / I'll look it up. / One moment. / Let me see. "
                        "Translate these naturally when the user is not speaking English. "
                        "Do not explain the search, mention sources, promise an answer, or add another sentence."
                    ),
                    "max_completion_tokens": 16,
                }
                self.assertEqual(config["interim_response"], expected)
                self.assertEqual(VoiceAgentDefinition(config).as_dict()["interim_response"], expected)
                self.assertIn("Stay silent during local tool execution.", config["instructions"])
                self.assertIn(
                    "After all requested actions finish, give one brief result or error response.",
                    config["instructions"],
                )
                self.assertIn("Confirm an action only after its tool returns ok:true.", config["instructions"])

    def test_voice_auto_detects_five_languages_without_an_english_transcription_hint(self):
        config = definition("model", "en-US-AvaNeural", False)
        self.assertEqual(config["audio"]["input"]["transcription"], {"model": "whisper-1"})
        self.assertEqual(config["audio"]["output"]["voice"], "en-US-AvaMultilingualNeural")
        for language in ("English", "Mandarin Chinese", "German", "Japanese", "Korean"):
            self.assertIn(language, config["instructions"])
            self.assertIn(language, config["interim_response"]["instructions"])
        self.assertIn("Follow the language of each user turn without requiring a language switch.", config["instructions"])
        self.assertEqual(definition("model", "custom-multilingual-voice", True)["audio"]["output"]["voice"], "custom-multilingual-voice")

    def test_interim_phrases_are_short_and_varied(self):
        config = definition("model", "voice", False)["interim_response"]
        self.assertEqual(config["max_completion_tokens"], 16)
        self.assertIn("at most four words", config["instructions"])
        self.assertIn("use at most four words once.", AGENT_INSTRUCTIONS)
        phrases = ["Let me check.", "I'll look it up.", "One moment.", "Let me see."]
        for phrase in phrases:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, config["instructions"])
                self.assertLessEqual(len(phrase.split()), 4)
                self.assertEqual(phrase.count("."), 1)

    def test_agent_language_and_local_scope_contract(self):
        forbidden = re.compile(r"mock[\s_-]*up", re.IGNORECASE)
        catalog = definition("model", "voice", False)
        self.assertIsNone(forbidden.search(json.dumps(catalog)))
        self.assertIsNone(forbidden.search(json.dumps(tools())))
        self.assertIn("Confirm an action only after its tool returns ok:true.", AGENT_INSTRUCTIONS)
        self.assertIn("Call direct tools sequentially, without discovery or pre-action speech.", AGENT_INSTRUCTIONS)
        self.assertIn("Use local tools as the source of current state and action results.", AGENT_INSTRUCTIONS)
        self.assertIn("Do not claim that route guidance has started.", AGENT_INSTRUCTIONS)
        dispatcher = Dispatcher()
        for request in (
            call("get_vehicle_status", {}, "status"),
            call(SEARCH_TOOL, {"query": "temperature"}, "search"),
            call(arguments={"temperature_c": 100}, call_id="rejected"),
        ):
            result = dispatcher.dispatch(request)
            self.assertEqual(result["execution_scope"], "local_cockpit")
            self.assertIsNone(forbidden.search(json.dumps(result)))
        cancelled = dispatcher.dispatch(call(call_id="cancelled"), cancelled=True)
        self.assertEqual(cancelled["execution_scope"], "local_cockpit")
        root = Path(__file__).parent
        for name in ("index.html", "app.js", "car-view.js", "style.css"):
            with self.subTest(name=name):
                self.assertIsNone(forbidden.search((root / "static" / name).read_text(encoding="utf-8")))
        for name in ("README.md", "vehicle.py", "vehicle_voice_agent.py", "server.py"):
            with self.subTest(name=name):
                self.assertIsNone(forbidden.search((root / name).read_text(encoding="utf-8")))

    def test_search_ranks_intent_and_filters_available_tools(self):
        self.assertEqual(search("make the cabin cooler", frozenset(tool["name"] for tool in tools()))[0]["name"], "set_climate")
        self.assertEqual([tool["name"] for tool in search("turn music quieter", frozenset({"set_media_volume"}))], ["set_media_volume"])
        self.assertEqual(search("unlock doors", frozenset(tool["name"] for tool in tools()))[0]["name"], "set_vehicle_doors")
        self.assertIn("Does not unlock", search("doors", frozenset({"set_vehicle_doors"}))[0]["description"])
        self.assertEqual(search("volume", frozenset({"start_navigation"})), [])
        self.assertEqual(len(search("temperature media navigation status", frozenset(tool["name"] for tool in tools()))), 3)

    def test_search_validation_and_no_mutation(self):
        dispatcher = Dispatcher(discovery=True)
        before = dispatcher.vehicle.execute("get_vehicle_status", {})
        for index, query in enumerate(("", " ", "a" * 201, "cabin\n", 1, None)):
            result = dispatcher.dispatch(call(SEARCH_TOOL, {"query": query}, str(index)))
            self.assertFalse(result["ok"])
        self.assertEqual(dispatcher.discovered, [])
        self.assertEqual(dispatcher.vehicle.execute("get_vehicle_status", {}), before)

    def test_discovery_enforced_independently_of_schema(self):
        dispatcher = Dispatcher(discovery=True)
        self.assertEqual([tool["name"] for tool in dispatcher.response_tools()], [SEARCH_TOOL])
        self.assertFalse(dispatcher.dispatch(call())["ok"])
        result = dispatcher.dispatch(call(SEARCH_TOOL, {"query": "cabin temperature"}, "search"))
        self.assertTrue(result["ok"])
        self.assertIn("set_cabin_temperature", [tool["name"] for tool in result["matches"]])
        self.assertTrue(dispatcher.dispatch(call(call_id="execute"))["ok"])
        self.assertFalse(dispatcher.dispatch(call("set_media_volume", {"volume_percent": 30}, "not-discovered"))["ok"])
        self.assertEqual([tool["name"] for tool in Dispatcher(discovery=True).response_tools()], [SEARCH_TOOL])

    def test_disabled_capability_cannot_be_searched_or_executed(self):
        dispatcher = Dispatcher(discovery=True, available=frozenset({"get_vehicle_status"}))
        result = dispatcher.dispatch(call(SEARCH_TOOL, {"query": "media volume"}, "search"))
        self.assertNotIn("set_media_volume", [tool["name"] for tool in result["matches"]])
        self.assertFalse(dispatcher.dispatch(call("set_media_volume", {"volume_percent": 30}))["ok"])

    def test_endpoint_validation(self):
        endpoint = "https://account.services.ai.azure.com/api/projects/project"
        self.assertEqual(project_endpoint(endpoint + "/"), endpoint)
        for value in ("http://localhost/", endpoint + "?key=secret", endpoint + "/extra",
                      endpoint.replace("account.", "user@account."),
                      endpoint.replace(".com/", ".com:1234/")):
            with self.assertRaises(ValueError):
                project_endpoint(value)


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_barge_in_cancels_truncates_and_waits_before_next_turn(self):
        conn, notify, audio = connection(), AsyncMock(), BrowserAudio()
        dispatcher = Dispatcher()
        dispatcher.vehicle.execute("set_cabin_temperature", {"temperature_c": 22})
        session = Session(conn, dispatcher, audio, notify)
        await session.respond()
        await session.handle({"type": "response.created", "response": {"id": "r1"}})
        await session.handle({
            "type": "response.output_audio.delta", "response_id": "r1",
            "item_id": "audio1", "content_index": 0, "delta": bytes(48000),
        })
        await session.handle({"type": "input_audio_buffer.speech_started"})
        self.assertEqual(conn.send.call_args.kwargs, {})
        self.assertEqual(conn.send.call_args.args[0]["type"], "response.cancel")
        self.assertEqual(conn.send.call_args.args[0]["response_id"], "r1")
        self.assertTrue(audio.queue.empty())
        await session.handle({"type": "input_audio_buffer.committed"})
        await session.handle({"type": "response.done", "response": {"id": "r1", "status": "cancelled", "output": [call()]}})
        self.assertEqual(conn.response.create.await_count, 1)
        await session.handle({
            "type": "playback_interrupted", "sequence": 1,
            "items": [{"item_id": "audio1", "content_index": 0, "audio_end_ms": 500}],
        })
        self.assertEqual(conn.send.call_args.args[0], {
            "type": "conversation.item.truncate", "item_id": "audio1", "content_index": 0, "audio_end_ms": 500,
        })
        self.assertEqual(conn.response.create.await_count, 2)
        self.assertEqual(dispatcher.vehicle.temperature_c, 22)
        self.assertFalse(dispatcher.completed)
        await session.handle({
            "type": "response.output_audio.delta", "response_id": "r1", "item_id": "audio1", "delta": bytes(4800),
        })
        self.assertTrue(audio.queue.empty())

    async def test_interruption_before_response_created_defers_cancel(self):
        conn = connection()
        session = Session(conn, Dispatcher(), BrowserAudio(), AsyncMock())
        await session.respond()
        await session.handle({"type": "input_audio_buffer.speech_started"})
        conn.send.assert_not_awaited()
        await session.handle({"type": "response.created", "response": {"id": "r1"}})
        self.assertEqual(conn.send.call_args.args[0]["type"], "response.cancel")
        await session.handle({"type": "response.done", "response": {"id": "r1", "status": "completed", "output": [call()]}})
        self.assertEqual(session.dispatcher.vehicle.temperature_c, 21)
        self.assertTrue(session.dispatcher.completed["call-1"][2]["cancelled"])
        self.assertTrue(json.loads(conn.conversation.item.create.call_args.kwargs["item"]["output"])["cancelled"])
        await session.handle({"type": "playback_interrupted", "sequence": 1, "items": []})
        await session.handle({"type": "input_audio_buffer.committed"})
        self.assertEqual(conn.response.create.await_count, 2)

    async def test_completed_generation_can_be_interrupted_while_still_playing(self):
        conn = connection()
        session = Session(conn, Dispatcher(), BrowserAudio(), AsyncMock())
        await session.handle({
            "type": "response.output_audio.delta", "response_id": "r1",
            "item_id": "audio1", "delta": bytes(48000),
        })
        await session.handle({"type": "input_audio_buffer.speech_started"})
        conn.send.assert_not_awaited()
        await session.handle({
            "type": "playback_interrupted", "sequence": 1,
            "items": [{"item_id": "audio1", "content_index": 0, "audio_end_ms": 1000}],
        })
        conn.send.assert_not_awaited()

    async def test_only_correlated_cancel_races_are_tolerated(self):
        session = Session(connection(), Dispatcher())
        session.cancel_requests.add("cancel-request")
        await session.handle({"type": "error", "error": {"code": "response_cancel_not_active", "event_id": "cancel-request"}})
        with self.assertRaises(RuntimeError):
            await session.handle({"type": "error", "error": {"code": "response_cancel_not_active", "event_id": "unknown"}})

    async def test_invalid_playback_positions_never_truncate(self):
        for position in (True, -1, 1001):
            conn = connection()
            session = Session(conn, Dispatcher(), BrowserAudio(), AsyncMock())
            session.audio_items = {"audio1": (24000, 0)}
            session.interrupt_sequence = 1
            session.playback_ack_deadline = asyncio.get_running_loop().time() + 5
            with self.assertRaises(RuntimeError):
                await session.handle({
                    "type": "playback_interrupted", "sequence": 1,
                    "items": [{"item_id": "audio1", "content_index": 0, "audio_end_ms": position}],
                })
            conn.send.assert_not_awaited()

    async def test_multilingual_reply_survives_windows_console_encoding(self):
        buffer = io.BytesIO()
        console = io.TextIOWrapper(buffer, encoding="cp1252")
        conn, notify = connection(), AsyncMock()
        text = "\u5df2\u5c06\u6e29\u5ea6\u8bbe\u4e3a22\u00b0C\u3002"
        with redirect_stdout(console):
            configure_console()
            await Session(conn, Dispatcher(), notify=notify).handle(
                done([{"type": "message", "content": [{"text": text}]}]),
            )
            console.flush()
            self.assertIn(text, buffer.getvalue().decode("utf-8"))
        self.assertEqual(notify.await_args_list[-1].args[0]["stage"], "complete")
        self.assertEqual(notify.await_args_list[-1].args[0]["text"], text)
        console.close()

    async def test_search_registers_schemas_for_followup_then_executes(self):
        conn = connection()
        dispatcher = Dispatcher(discovery=True)
        session = Session(conn, dispatcher)
        await session.respond()
        self.assertEqual([tool["name"] for tool in conn.response.create.call_args.kwargs["response"]["tools"]], [SEARCH_TOOL])
        await session.handle(done([call(SEARCH_TOOL, {"query": "cabin temperature"}, "search")]))
        exposed = [tool["name"] for tool in conn.response.create.call_args.kwargs["response"]["tools"]]
        self.assertIn("set_cabin_temperature", exposed)
        self.assertNotIn("start_navigation", exposed)
        self.assertEqual(dispatcher.vehicle.temperature_c, 21)
        await session.handle(done())
        self.assertEqual(dispatcher.vehicle.temperature_c, 22)

    async def test_agent_is_created_and_enabled_only_once(self):
        agents = SimpleNamespace(create_version=AsyncMock(), enable=AsyncMock())
        settings = Settings(False, 8765, client=SimpleNamespace(agents=agents))
        socket = SimpleNamespace(send_json=AsyncMock())
        first = await ensure_agent(settings, socket)
        second = await ensure_agent(settings, socket)
        self.assertEqual(first, second)
        agents.create_version.assert_awaited_once()
        agents.enable.assert_awaited_once()

    async def test_each_user_turn_requires_fresh_search(self):
        conn, dispatcher = connection(), Dispatcher(discovery=True)
        session = Session(conn, dispatcher)
        for index in range(2):
            await session.handle({"type": "input_audio_buffer.committed"})
            self.assertEqual(dispatcher.discovered, [])
            self.assertEqual(
                [tool["name"] for tool in conn.response.create.call_args.kwargs["response"]["tools"]],
                [SEARCH_TOOL],
            )
            rejected = dispatcher.dispatch(call(call_id=f"unsearched-{index}"))
            self.assertFalse(rejected["ok"])
            await session.handle(done([call(SEARCH_TOOL, {"query": "cabin temperature"}, f"search-{index}")]))
            self.assertIn("set_cabin_temperature", dispatcher.discovered)
            await session.handle(done([call(call_id=f"execute-{index}")]))
            self.assertEqual(dispatcher.vehicle.temperature_c, 22)
            self.assertIn("set_cabin_temperature", dispatcher.discovered)
            await session.handle(done([{"type": "message", "content": [{"text": "Set to 22 degrees."}]}]))
        self.assertEqual(session.turn_id, 2)
        searches = [
            name for name, _arguments, _result in dispatcher.completed.values() if name == SEARCH_TOOL
        ]
        self.assertEqual(searches, [SEARCH_TOOL, SEARCH_TOOL])

    async def test_queued_turn_clears_discovery_only_after_current_reply(self):
        conn, dispatcher = connection(), Dispatcher(discovery=True)
        session = Session(conn, dispatcher)
        await session.handle({"type": "input_audio_buffer.committed"})
        await session.handle(done([call(SEARCH_TOOL, {"query": "cabin temperature"}, "search")]))
        await session.handle({"type": "input_audio_buffer.committed"})
        self.assertIn("set_cabin_temperature", dispatcher.discovered)
        await session.handle(done())
        self.assertEqual(dispatcher.vehicle.temperature_c, 22)
        await session.handle(done([{"type": "message", "content": [{"text": "Set to 22 degrees."}]}]))
        self.assertEqual(dispatcher.discovered, [])
        self.assertEqual(
            [tool["name"] for tool in conn.response.create.call_args.kwargs["response"]["tools"]],
            [SEARCH_TOOL],
        )

    async def test_text_turn_clears_previous_discovery(self):
        conn, dispatcher = connection(), Dispatcher(discovery=True)
        dispatcher.execute(SEARCH_TOOL, {"query": "cabin temperature"})
        conn.recv.side_effect = [
            done([call(SEARCH_TOOL, {"query": "media volume"}, "search")]),
            done([call("set_media_volume", {"volume_percent": 30}, "volume")]),
            done([{"type": "message", "content": [{"text": "Volume set to 30 percent."}]}]),
        ]
        await text_turn(conn, dispatcher, "Set volume to 30 percent.")
        self.assertEqual(
            [tool["name"] for tool in conn.response.create.await_args_list[0].kwargs["response"]["tools"]],
            [SEARCH_TOOL],
        )
        self.assertNotIn("set_cabin_temperature", dispatcher.discovered)
        self.assertEqual(dispatcher.vehicle.volume_percent, 30)

    async def test_completed_calls_execute_and_return_matching_id(self):
        conn, dispatcher, notify = connection(), Dispatcher(), AsyncMock()
        session = Session(conn, dispatcher, notify=notify)
        await session.respond()
        conn.response.create.reset_mock()
        await session.handle(done())
        item = conn.conversation.item.create.call_args.kwargs["item"]
        self.assertEqual(item["type"], "function_call_output")
        self.assertEqual(item["call_id"], "call-1")
        self.assertTrue(json.loads(item["output"])["ok"])
        self.assertEqual(dispatcher.vehicle.temperature_c, 22)
        conn.response.create.assert_awaited_once()
        self.assertEqual(
            [item.args[0]["stage"] for item in notify.await_args_list if item.args[0]["type"] == "process"],
            ["executing", "result", "responding"],
        )

    async def test_process_events_report_real_search_and_execution(self):
        conn, notify = connection(), AsyncMock()
        session = Session(conn, Dispatcher(discovery=True), notify=notify)
        await session.handle({"type": "input_audio_buffer.speech_started"})
        await session.handle({"type": "input_audio_buffer.committed"})
        await session.handle(done([call(SEARCH_TOOL, {"query": "cabin temperature"}, "search")]))
        await session.handle(done())
        await session.handle(done([{"type": "message", "content": [{"text": "Set to 22 degrees."}]}]))
        events = [item.args[0] for item in notify.await_args_list if item.args[0]["type"] == "process"]
        self.assertEqual([event["stage"] for event in events], [
            "listening", "understanding", "searching", "discovered", "responding",
            "executing", "result", "responding", "complete",
        ])
        self.assertEqual(events[0]["next_turn"], 1)
        self.assertEqual(events[2]["arguments"], '{"query": "cabin temperature"}')
        self.assertEqual(events[3]["result"]["matches"][0]["name"], "set_cabin_temperature")
        self.assertEqual(events[6]["result"]["state"]["temperature_c"], 22)

    async def test_argument_deltas_never_execute(self):
        dispatcher = Dispatcher()
        session = Session(connection(), dispatcher)
        await session.handle({**call(), "type": "response.function_call_arguments.done"})
        self.assertFalse(dispatcher.completed)

    async def test_cancelled_failed_and_parallel_calls_never_execute(self):
        for event in (done(status="cancelled"), done(status="failed"), done([call(), call(call_id="call-2")])):
            dispatcher = Dispatcher()
            with self.assertRaises(RuntimeError):
                await Session(connection(), dispatcher).handle(event)
            self.assertFalse(dispatcher.completed)

    async def test_rejection_is_submitted_as_failure(self):
        conn = connection()
        await Session(conn, Dispatcher()).handle(done([call("unlock_doors", {})]))
        result = json.loads(conn.conversation.item.create.call_args.kwargs["item"]["output"])
        self.assertFalse(result["ok"])

    async def test_queued_turn_waits_for_tool_feedback(self):
        conn = connection()
        session = Session(conn, Dispatcher())
        await session.handle({"type": "input_audio_buffer.committed"})
        await session.handle({"type": "input_audio_buffer.committed"})
        self.assertEqual(session.pending_turns, 1)
        await session.handle(done())
        self.assertEqual(session.pending_turns, 1)
        await session.handle(done([{"type": "message", "content": [{"text": "Set to 22 degrees."}]}]))
        self.assertEqual(session.pending_turns, 0)
        self.assertEqual(conn.response.create.await_count, 3)

    async def test_round_limit_and_empty_feedback_fail(self):
        session = Session(connection(), Dispatcher())
        session.tool_rounds = 8
        with self.assertRaises(RuntimeError):
            await session.handle(done())
        self.assertFalse(session.dispatcher.completed)
        with self.assertRaises(RuntimeError):
            await session.handle(done([]))

    async def test_text_mode_full_tool_loop(self):
        conn = connection()
        conn.recv.side_effect = [
            {"type": "response.function_call_arguments.delta", "delta": "{}"},
            done(),
            {"type": "response.output_text.done", "text": "The cabin setting is 22 degrees Celsius."},
            done([]),
        ]
        dispatcher = Dispatcher()
        await text_turn(conn, dispatcher, "Set cabin temperature to 22 Celsius.")
        self.assertEqual(dispatcher.vehicle.temperature_c, 22)
        self.assertEqual(conn.conversation.item.create.await_count, 2)
        self.assertEqual(conn.response.create.await_count, 2)

    async def test_audio_queue_is_bounded(self):
        audio = BrowserAudio()
        event = {"item_id": "audio1", "response_id": "r1"}
        for _ in range(256):
            audio.output(b"\x00\x00", event)
        with self.assertRaises(RuntimeError):
            audio.output(b"\x00\x00", event)
        with self.assertRaises(RuntimeError):
            BrowserAudio().output(b"\x00", event)


class WebTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = TestClient(TestServer(create_app(True, 8765)))
        await self.client.start_server()
        self.client.server.app[SETTINGS].port = self.client.server.port
        self.origin = str(self.client.make_url("")).rstrip("/")

    async def asyncTearDown(self):
        await self.client.close()

    async def test_page_and_assets(self):
        response = await self.client.get("/")
        self.assertEqual(response.status, 200)
        page = await response.text()
        self.assertIn("LOCAL COCKPIT", page)
        self.assertIn("NO VEHICLE HARDWARE CONNECTED", page)
        self.assertNotIn('id="wheel-roll"', page)
        state = await (await self.client.get("/api/state")).json()
        self.assertEqual(state["execution_scope"], "local_cockpit")
        for name in ("app.js", "style.css", "agent-theme.css", "pcm-worklet.js", "playback.js", "car.svg",
                     "car-view.js", "car-model.mjs", "vehicle-doors.glb", "three.module.js",
                     "three.core.js", "OrbitControls.js", "vendor/loaders/GLTFLoader.js",
                     "vendor/utils/BufferGeometryUtils.js", "vendor/environments/RoomEnvironment.js",
                     "drive-cycle.mjs", "ftp75.txt", "i18n.mjs"):
            self.assertEqual((await self.client.get("/static/" + name)).status, 200)
        self.assertEqual((await self.client.get("/static/server.py")).status, 404)
        self.assertEqual((await self.client.get("/static/vendor/server.py")).status, 404)

    async def test_door_controls_return_authoritative_state(self):
        response = await self.client.post("/api/tool", headers={"Origin": self.origin}, json={
            "name": "set_vehicle_doors", "arguments": {"door": "all", "is_open": True},
        })
        self.assertEqual(response.status, 200)
        self.assertTrue(all((await response.json())["state"]["doors"].values()))
        response = await self.client.post("/api/tool", headers={"Origin": self.origin}, json={
            "name": "set_vehicle_doors", "arguments": {"door": "rear_right", "is_open": False},
        })
        self.assertEqual(response.status, 200)
        self.assertFalse((await response.json())["state"]["doors"]["rear_right"])
        state = await (await self.client.get("/api/state")).json()
        self.assertEqual(sum(state["state"]["doors"].values()), 3)

    async def test_windows_and_lids_return_authoritative_state(self):
        for name, arguments in (
            ("set_vehicle_windows", {"window": "front_right", "is_open": True}),
            ("set_vehicle_lid", {"lid": "hood", "is_open": True}),
            ("set_vehicle_lid", {"lid": "trunk", "is_open": True}),
        ):
            response = await self.client.post("/api/tool", headers={"Origin": self.origin}, json={
                "name": name, "arguments": arguments,
            })
            self.assertEqual(response.status, 200)
            self.assertTrue((await response.json())["ok"])
        state = (await (await self.client.get("/api/state")).json())["state"]
        self.assertTrue(state["windows"]["front_right"])
        self.assertFalse(any(state["doors"].values()))
        self.assertTrue(all(state["lids"].values()))
        self.assertNotIn("wheels_rolling", state)
        invalid = await self.client.post("/api/tool", headers={"Origin": self.origin}, json={
            "name": "set_wheel_animation", "arguments": {"running": True},
        })
        self.assertEqual(invalid.status, 400)
        self.assertEqual((await (await self.client.get("/api/state")).json())["state"], state)

    async def test_controls_update_state_and_reject_invalid_actions(self):
        response = await self.client.post("/api/tool", headers={"Origin": self.origin}, json={
            "name": "set_cabin_temperature", "arguments": {"temperature_c": 24},
        })
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["state"]["temperature_c"], 24)
        response = await self.client.post("/api/tool", headers={"Origin": self.origin}, json={
            "name": "unlock_doors", "arguments": {},
        })
        self.assertEqual(response.status, 400)
        self.assertFalse((await response.json())["ok"])
        state = await (await self.client.get("/api/state")).json()
        self.assertEqual(state["state"]["temperature_c"], 24)
        self.assertEqual(state["mode"], "offline")

    async def test_cross_origin_and_host_rejected(self):
        for headers in ({}, {"Origin": "https://untrusted.example"}, {"Origin": "null"}):
            response = await self.client.post("/api/tool", headers=headers, json={"name": "get_vehicle_status", "arguments": {}})
            self.assertEqual(response.status, 403)
        response = await self.client.get("/api/state", headers={"Host": "untrusted.example"})
        self.assertEqual(response.status, 403)

    async def test_offline_voice_and_bad_json_rejected(self):
        self.assertEqual((await self.client.get("/ws", headers={"Origin": self.origin})).status, 400)
        self.assertEqual((await self.client.post("/api/tool", headers={"Origin": self.origin}, data="{")).status, 400)

    async def test_second_browser_gets_actionable_error_without_releasing_active_session(self):
        settings = self.client.server.app[SETTINGS]
        settings.demo = False

        async def connected(_request, socket, _incoming):
            await socket.send_json({"type": "ready"})
            await asyncio.Event().wait()

        with patch("server.cloud_session", side_effect=connected) as cloud:
            async with asyncio.timeout(10):
                first = await self.client.ws_connect("/ws", headers={"Origin": self.origin})
                self.assertEqual(await first.receive_json(), {"type": "ready"})
                second = await self.client.ws_connect("/ws", headers={"Origin": self.origin})
                message = await second.receive_json()
                self.assertEqual(message["type"], "error")
                self.assertIn("Disconnect voice in that browser or tab", message["message"])
                await second.close()
                self.assertTrue(settings.voice_active)
                self.assertFalse(first.closed)
                self.assertEqual(cloud.await_count, 1)
                third = await self.client.ws_connect("/ws", headers={"Origin": self.origin})
                self.assertEqual(await third.receive_json(), message)
                await third.close()
                await first.close()
                while settings.voice_active:
                    await asyncio.sleep(0)
                replacement = await self.client.ws_connect("/ws", headers={"Origin": self.origin})
                self.assertEqual(await replacement.receive_json(), {"type": "ready"})
                self.assertEqual(cloud.await_count, 2)
                await replacement.close()
                while settings.voice_active:
                    await asyncio.sleep(0)

    async def test_heartbeat_is_read_during_setup_and_disconnect_cancels_setup(self):
        from aiohttp import web

        self.client.server.app[SETTINGS].demo = False
        cancelled = asyncio.Event()
        original = web.WebSocketResponse

        def fast_heartbeat(**kwargs):
            kwargs["heartbeat"] = 1
            return original(**kwargs)

        async def slow_setup(_request, socket, _incoming):
            try:
                await asyncio.sleep(3.2)
                await socket.send_json({"type": "ready"})
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        with patch("server.web.WebSocketResponse", side_effect=fast_heartbeat), patch("server.cloud_session", side_effect=slow_setup):
            socket = await self.client.ws_connect("/ws", headers={"Origin": self.origin})
            async with asyncio.timeout(10):
                self.assertEqual(await socket.receive_json(), {"type": "ready"})
                await socket.close()
                await cancelled.wait()
                while self.client.server.app[SETTINGS].voice_active:
                    await asyncio.sleep(0)
            self.assertFalse(self.client.server.app[SETTINGS].voice_active)


if __name__ == "__main__":
    unittest.main()
