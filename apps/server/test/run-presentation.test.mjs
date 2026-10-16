import test from "node:test";
import assert from "node:assert/strict";
import { primaryRunOutput, outputPreview } from "../../web/src/run-presentation.ts";

test("primary output selects final coordinator result rather than intermediate specialist chatter", () => {
  const run = { status: "completed", tasks: [
    { role: "orchestrator", status: "completed", summary: "Final product result" },
    { role: "hardware", status: "completed", summary: "Verbose hardware detail" },
  ], events: [{ type: "text", role: "hardware", text: "Intermediate output" }] };
  assert.equal(primaryRunOutput(run), "Final product result");
  assert.equal(primaryRunOutput({ ...run, status: "running", tasks: run.tasks.map(task => ({ ...task, status: "running" })) }), "");
  assert.equal(primaryRunOutput({ status: "completed", tasks: [], events: [{ type: "text", role: "orchestrator", text: "Latest result" }] }), "Latest result");
});

test("compact preview strips Markdown heading markers without changing original source", () => {
  const source = '## Result\n\n**Saved** `part.stl`\n\n\nNext step';
  assert.equal(outputPreview(source), 'Result\n\nSaved part.stl\n\nNext step');
  assert.ok(source.includes('**Saved**'));
});
