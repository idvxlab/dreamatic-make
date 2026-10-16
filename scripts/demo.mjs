/** Explicit offline demo, isolated from the user's normal .data directory. */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../apps/server/dist/store.js";
import { DesignStore } from "../apps/server/dist/design-store.js";
import { generateCAD } from "../apps/server/dist/cad.js";
import { createApp } from "../apps/server/dist/app.js";
const dir = await mkdtemp(join(tmpdir(), "dreamatic-make-demo-"));
const store = new Store(dir);
await store.init();
const design = new DesignStore(store);
const project = await store.createProject({
  name: "桌面监测器 · 离线工具演示",
});
await store.updateProject(project.id, {
  updatedAt: project.updatedAt,
  notes: "这是离线工具与界面演示。未调用 AI、未选定实际硬件、未打印或实测。",
});
const entry = async (
  id,
  owner,
  title,
  content,
  data = {},
  dependsOn = [],
  artifactIds = [],
) =>
  design.patch(project.id, "user", {
    id,
    owner,
    title,
    content,
    data,
    dependsOn,
    artifactIds,
    baseRevision: 0,
    status: "draft",
    reason: "Explicit offline demo fixture; no AI or physical test",
  });
await entry(
  "product.requirements",
  "product",
  "桌面监测器原型",
  "演示目标：一体化外壳、可拆底盖、显示窗口和模块安装空间。具体硬件、预算与打印条件待用户确认。",
  { kind: "requirements", demo: true, validation: "not_tested" },
);
await entry(
  "hardware.placeholder",
  "hardware",
  "电子模块包络占位",
  "示例尺寸仅用于模型与界面演示；不对应任何已核实可采购型号。",
  {
    kind: "component",
    name: "模块包络（待选型）",
    model: "UNSELECTED",
    quantity: 1,
    dimensionsMm: [40, 25, 8],
    uncertainties: ["准确型号、孔位、电气接口与采购信息均待核实"],
    demo: true,
  },
  ["product.requirements"],
);
const shell = {
  parameters: { width: 70, depth: 48, height: 26 },
  geometry: {
    op: "subtract",
    children: [
      { op: "box", size: ["$width", "$depth", "$height"] },
      {
        op: "translate",
        value: [0, 0, -2],
        child: { op: "box", size: [66, 44, 26] },
      },
      {
        op: "translate",
        value: [0, 0, 12],
        child: { op: "box", size: [38, 22, 8] },
      },
    ],
  },
};
const generated = generateCAD(shell);
const modelFiles = [];
for (const [name, content, kind, mediaType] of [
  ["enclosure.stl", generated.stl, "mesh", "model/stl"],
  ["enclosure.scad", generated.scad, "cad", "text/plain"],
  [
    "enclosure.json",
    JSON.stringify(generated.recipe, null, 2),
    "cad",
    "application/json",
  ],
  [
    "enclosure-check.json",
    JSON.stringify(generated.report, null, 2),
    "document",
    "application/json",
  ],
])
  modelFiles.push(
    await design.artifact(project.id, "mechanical", {
      name,
      content,
      kind,
      mediaType,
      inputRevisions: { "hardware.placeholder": 1 },
    }),
  );
await entry(
  "mechanical.enclosure",
  "mechanical",
  "参数化显示外壳",
  "真实 CSG 模型：70 × 48 × 26 mm，底部开口，顶部显示窗口。占位尺寸未经硬件试配。JSON 配方和 OpenSCAD 源文件可编辑，STL 可在模型视图旋转查看。",
  {
    kind: "part",
    units: "mm",
    printTest: "pending",
    parameters: shell.parameters,
  },
  ["hardware.placeholder"],
  modelFiles.map((file) => file.id),
);
const firmware = await design.artifact(project.id, "firmware", {
  name: "firmware-notes.md",
  content:
    "# Firmware\n\nOffline demonstration only. Board, display driver and pin assignments have not been selected. Do not flash placeholder firmware.\n",
  kind: "firmware",
  mediaType: "text/markdown",
});
await entry(
  "firmware.plan",
  "firmware",
  "设备交互计划",
  "计划包含数据显示、模式切换与错误状态；待选定主控、传感器、屏幕后实现并编译。",
  { kind: "firmware_plan", compiled: false, flashed: false },
  ["hardware.placeholder"],
  [firmware.id],
);
await entry(
  "validation.checklist",
  "validation",
  "试配与验证清单",
  "已运行：本地 CSG 几何有效性与体积检查。\n待完成：硬件尺寸核实、安装间隙、打印方向、切片、试配、接线与固件测试。",
  {
    kind: "verification",
    physicalTestsPerformed: false,
    issues: ["占位组件不能作为正式安装尺寸", "尚未完成紧固与底盖设计"],
  },
  ["mechanical.enclosure", "firmware.plan"],
);
const guide = await design.artifact(project.id, "documentation", {
  name: "assembly-guide.md",
  kind: "document",
  mediaType: "text/markdown",
  content:
    "# Prototype Build Guide (Draft)\n\nThis project demonstrates local functionality only.\n\n1. Verify the hardware models and actual dimensions.\n2. Update the enclosure recipe, cover, and fastening geometry.\n3. Print small fit-test coupons and record printing conditions.\n4. Print complete parts after fit tests pass.\n5. Assemble and test using verified wiring and firmware instructions.\n\nNo purchasing, printing, successful compilation, or passing physical tests have been recorded.\n",
});
await entry(
  "documentation.guide",
  "documentation",
  "制作与装配说明",
  "装配说明依据当前模型、占位部件和验证清单，仍是待完善草案。",
  { kind: "guide", status: "draft" },
  ["validation.checklist"],
  [guide.id],
);
await entry(
  "orchestrator.next",
  "orchestrator",
  "下一步：明确制造条件",
  "请补充实际硬件、打印机、材料、预算和交互要求。之后由总控按需分派专业角色。此演示没有运行 AI。",
  { kind: "plan", demo: true },
  ["product.requirements"],
);
const root = fileURLToPath(new URL("..", import.meta.url));
const app = createApp(store, resolve(root, "apps/web/dist"), { design });
app.listen(4312, "127.0.0.1", () =>
  console.log(
    `Offline demo: http://127.0.0.1:4312\nTemporary data: ${dir}\nNo AI, purchases or physical tests were performed.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    app.close();
    app.closeAllConnections();
  });
