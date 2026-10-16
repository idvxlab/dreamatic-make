import test from "node:test";
import assert from "node:assert/strict";
import { clarificationHeading } from "@harness/core";

test("choice headings omit repeated Markdown proposals while retaining original stored text", () => {
  const content = '关于连接和数据功能，你希望环境监测器支持哪些功能？\n\n**方案 A - 仅本地显示**：本地屏幕。\n\n**方案 B - WiFi**：支持网页。\n- 历史记录\n\n（外观稍后询问）';
  assert.equal(clarificationHeading(content, true), '关于连接和数据功能，你希望环境监测器支持哪些功能？');
  assert.ok(content.includes('**方案 A'));
  assert.equal(clarificationHeading('**Which connection?**\n\n**A** Offline\n**B** Wi-Fi', true), 'Which connection?');
  assert.equal(clarificationHeading('请选择供电方式\n\n**USB**：桌面使用\n**电池**：便携', true), '请选择供电方式');
  assert.equal(clarificationHeading('监测哪些参数？（可多选）', true), '监测哪些参数？');
});

test("open questions retain context and choice labels without duplicated descriptions remain unchanged", () => {
  const content = 'Please measure the enclosure.\n\nInclude the connector and cable clearance.';
  assert.equal(clarificationHeading(content, false), content);
  assert.equal(clarificationHeading('Choose a material', true), 'Choose a material');
  assert.equal(clarificationHeading('**选择材料**', true), '选择材料');
});
