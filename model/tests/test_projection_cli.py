import json
import subprocess
import sys
import unittest
from model.examples.build_examples import actuator_example, fan_example
from model.compiler.lower import compile_model
from model.simulator.engine import simulate
from model.projection.scene import project_scene
from model.projection.circuit import project_circuit
from model.projection.flow import project_flow


class ProjectionAndCliTests(unittest.TestCase):
    def test_views_share_identity_and_snapshot(self):
        bundle, scenario = actuator_example()
        ir = compile_model(bundle)
        result = simulate(ir, scenario)
        scene = project_scene(ir, result)
        circuit = project_circuit(ir, result)
        self.assertEqual(scene["snapshot_id"], circuit["snapshot_id"])
        self.assertEqual(scene["time_s"], circuit["time_s"])
        self.assertIn("servo/bodies/case", [b["entity_ref"] for b in scene["bodies"]])
        self.assertIn("servo/terminals/vcc", [b["entity_ref"] for b in circuit["terminals"]])
        with self.assertRaises(ValueError):
            project_scene(ir, result.model_copy(update={"snapshot_id": "0" * 64}))

    def test_flow_is_explicitly_topology_only(self):
        bundle, _ = fan_example()
        view = project_flow(compile_model(bundle))
        self.assertEqual(view["mode"], "topology_only")
        self.assertEqual(len(view["paths"]), 1)
        self.assertEqual(len(view["ports"]), 2)

    def test_cli_request_is_single_json_result(self):
        bundle, scenario = actuator_example()
        request = {"request_id": "test-request", "method": "simulate", "bundle": bundle.model_dump(mode="json"),
                   "scenario": scenario.model_dump(mode="json")}
        run = subprocess.run([sys.executable, "-B", "-m", "model", "request"], input=json.dumps(request),
                             text=True, capture_output=True, timeout=20)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        output = json.loads(run.stdout)
        self.assertEqual(output["request_id"], "test-request")
        self.assertEqual(output["payload"]["status"], "completed")
        self.assertEqual(run.stderr, "")

    def test_cli_invalid_input_is_error_without_traceback(self):
        run = subprocess.run([sys.executable, "-B", "-m", "model", "request"], input='{"request_id":"a","request_id":"b"}',
                             text=True, capture_output=True, timeout=20)
        self.assertEqual(run.returncode, 2)
        self.assertEqual(json.loads(run.stdout)["type"], "error")
        self.assertNotIn("Traceback", run.stderr)
