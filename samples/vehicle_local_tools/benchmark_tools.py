"""Reproducible payload estimates; never substitutes for paid live model telemetry."""

import argparse
import json
import statistics
import time

from tool_contracts import definitions
from vehicle import Dispatcher, LocalVehicle, SEARCH_TAGS, legacy_tools, search, search_tool
from vehicle_voice_agent import AGENT_INSTRUCTIONS


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def measure():
    import tiktoken
    encoder = tiktoken.get_encoding("o200k_base")
    tokens = lambda value: len(encoder.encode(value if isinstance(value, str) else compact(value)))
    corpus = [
        ("temperature", "set_cabin_temperature", "set_climate", {"temperature_c": 22}),
        ("media volume", "set_media_volume", "set_media_volume", {"volume_percent": 30}),
        ("navigation destination", "start_navigation", "set_destination", {"destination": "Library"}),
        ("door", "set_vehicle_doors", "set_vehicle_doors", {"door": "all", "is_open": True}),
        ("glass window", "set_vehicle_windows", "set_vehicle_windows", {"window": "all", "is_open": True}),
        ("hood", "set_vehicle_lid", "set_vehicle_lid", {"lid": "hood", "is_open": True}),
    ]
    rows = []
    timings = []
    for query, old_name, new_name, args in corpus:
        matches = search(query, frozenset(SEARCH_TAGS))
        old_result = LocalVehicle().execute(old_name, args)
        new_result = Dispatcher().execute(new_name, args)
        search_result = Dispatcher(discovery=True).execute("search_vehicle_tools", {"query": query})
        # Identical legacy seven-function schemas isolate discovery overhead.
        discovered = [search_tool(), *matches]
        search_frames = [
            {"instructions": AGENT_INSTRUCTIONS, "tools": [search_tool()]},
            {"instructions": AGENT_INSTRUCTIONS, "tools": discovered, "outputs": [search_result]},
            {"instructions": AGENT_INSTRUCTIONS, "tools": discovered, "outputs": [search_result, old_result]},
        ]
        direct_frames = [
            {"instructions": AGENT_INSTRUCTIONS, "tools": legacy_tools()},
            {"instructions": AGENT_INSTRUCTIONS, "tools": legacy_tools(), "outputs": [new_result]},
        ]
        old_tokens, new_tokens = sum(map(tokens, search_frames)), sum(map(tokens, direct_frames))
        rows.append({"command": new_name, "search_frame_tokens": old_tokens, "direct_frame_tokens": new_tokens,
                     "change_percent": round((new_tokens / old_tokens - 1) * 100, 1),
                     "old_result_tokens": tokens(old_result), "direct_result_tokens": tokens(new_result)})
    dispatcher = Dispatcher()
    for _ in range(1000):
        start = time.perf_counter_ns()
        dispatcher.execute("set_climate", {"temperature_c": 22})
        timings.append((time.perf_counter_ns() - start) / 1e6)
    catalog_tokens = tokens(definitions())
    prompt_tokens = tokens(AGENT_INSTRUCTIONS)
    return {
        "method": "o200k_base text estimates of serialized request frames, not Azure billing or live context/cache usage",
        "catalog": {"tools": len(definitions()), "bytes": len(compact(definitions()).encode()), "estimated_tokens": catalog_tokens},
        "prompt_estimated_tokens": prompt_tokens,
        "common_result_max_estimated_tokens": max(row["direct_result_tokens"] for row in rows),
        "local_dispatch_p95_ms": statistics.quantiles(timings, n=100)[94],
        "rounds": {"search_first": 3, "direct": 2}, "routine_searches": 0,
        "equivalent_seven_command_frames": rows,
        "expanded_direct_frame_tokens": tokens({"instructions": AGENT_INSTRUCTIONS, "tools": definitions()}),
        "gates": {"catalog_le_1700_estimated_tokens": catalog_tokens <= 1700,
                  "prompt_le_350_estimated_tokens": prompt_tokens <= 350,
                  "common_result_le_120_estimated_tokens": max(row["direct_result_tokens"] for row in rows) <= 120,
                  "local_dispatch_p95_below_25_ms": statistics.quantiles(timings, n=100)[94] < 25},
        "not_measured": ["live token usage and cache hits", "cold/warm voice sessions", "p95 first-action voice latency",
                         "20 percent live cost/latency targets", "grounding retrieval latency"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=argparse.FileType("w", encoding="utf-8"))
    args = parser.parse_args()
    result = measure()
    output = json.dumps(result, indent=2)
    if args.output:
        args.output.write(output + "\n")
        args.output.close()
    print(output)
