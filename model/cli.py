"""Machine-readable CLI. No shell execution, providers, or implicit file imports."""

import argparse
import json
import sys
from pathlib import Path
from pydantic import ValidationError
from model.base.diagnostic import ModelError
from model.compiler.lower import compile_model
from model.io.load import load, loads, MAX_BYTES
from model.io.save import content_hash, canonical_json
from model.io.json_schema import export_schema
from model.schema.assembly import ModelBundle
from model.schema.scenario import Scenario
from model.simulator.engine import simulate
from model.projection.scene import project_scene
from model.projection.circuit import project_circuit
from model.projection.flow import project_flow


def dispatch(method, bundle, scenario=None):
    ir = compile_model(bundle)
    if method in ("validate", "compile"):
        return {"snapshot_id": ir.snapshot_id, "input_revisions": dict(ir.input_revisions),
                "bodies": len(ir.collection("bodies")), "joints": len(ir.joints), "nets": len(ir.nets),
                "diagnostics": [d.model_dump(mode="json") for d in ir.diagnostics],
                **({"snapshot": json.loads(ir.canonical_snapshot)} if method == "compile" else {})}
    if method == "simulate":
        if scenario is None:
            raise ValueError("simulate requires a scenario")
        return simulate(ir, scenario).model_dump(mode="json")
    if method == "scene":
        return project_scene(ir)
    if method == "circuit":
        return project_circuit(ir)
    if method == "flow":
        return project_flow(ir)
    raise ValueError(f"Unknown method: {method}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline product model tools")
    parser.add_argument("method", choices=["validate", "compile", "simulate", "scene", "circuit", "flow", "schema", "request"])
    parser.add_argument("input", nargs="?")
    parser.add_argument("--scenario")
    args = parser.parse_args(argv)
    request_id = None
    try:
        if args.method == "schema":
            output = export_schema(args.input or "model_bundle")
        elif args.method == "request":
            # One bounded request per process. Inline snapshots eliminate implicit path access.
            from model.io.load import _unique, _nonfinite
            text = sys.stdin.buffer.read(MAX_BYTES + 1)
            if len(text) > MAX_BYTES:
                raise ValueError("Request exceeds size limit")
            request = json.loads(text, object_pairs_hook=_unique, parse_constant=_nonfinite)
            if not isinstance(request, dict) or set(request) - {"request_id", "method", "bundle", "scenario"}:
                raise ValueError("Unexpected request fields")
            request_id = request.get("request_id")
            if not isinstance(request_id, str) or len(request_id) > 128:
                raise ValueError("request_id must be a short string")
            bundle = loads(json.dumps(request["bundle"], allow_nan=False), ModelBundle)
            scenario = loads(json.dumps(request["scenario"], allow_nan=False), Scenario) if request.get("scenario") else None
            output = {"request_id": request_id, "type": "result", "payload": dispatch(request["method"], bundle, scenario)}
        else:
            if not args.input:
                raise ValueError("A model bundle path is required")
            bundle = load(args.input, ModelBundle)
            scenario = load(args.scenario, Scenario) if args.scenario else None
            output = dispatch(args.method, bundle, scenario)
        print(json.dumps(output, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
        payload = output.get("payload", output)
        return 0 if payload.get("status", "completed") == "completed" else 2
    except (ValueError, OSError, KeyError, RecursionError) as exc:
        if isinstance(exc, ModelError):
            details = [d.model_dump(mode="json") for d in exc.diagnostics]
        elif isinstance(exc, ValidationError):
            # Do not echo arbitrary input values or exception context into protocol output.
            details = [{"location": list(e["loc"]), "message": e["msg"], "type": e["type"]}
                       for e in exc.errors(include_input=False, include_context=False)]
        else:
            details = [{"message": str(exc)}]
        print(json.dumps({"request_id": request_id, "type": "error", "diagnostics": details}, ensure_ascii=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
