from model.examples.build_examples import parse, definition_ref
from model.schema.component import ComponentDefinition
from model.schema.assembly import ModelBundle
from model.schema.scenario import Scenario
from model.compiler.lower import compile_model


def single(data, scenario=None):
    component = parse(ComponentDefinition, {"id": "test.component", "name": "Test component", **data})
    bundle = parse(ModelBundle, {"components": [component.model_dump(mode="json")], "root": definition_ref(component)})
    ir = compile_model(bundle)
    run = parse(Scenario, {"id": "test", "snapshot_id": ir.snapshot_id, "duration_s": 0.2, **(scenario or {})})
    return ir, run
