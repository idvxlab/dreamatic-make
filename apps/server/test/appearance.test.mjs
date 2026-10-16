import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { Store } from "../dist/store.js";
import { DesignStore } from "../dist/design-store.js";
import { AgentRuntime } from "../dist/agents/runtime.js";
import { AppearanceService, imageBytes } from "../dist/appearance.js";
import { createApp } from "../dist/app.js";
import { APPEARANCE_GATE, approvedAppearance } from "@harness/core";
const image = new PhotonImage(new Uint8Array(8 * 8 * 4).fill(255), 8, 8);
const PNG = Buffer.from(image.get_bytes());image.free();
async function listen(t, server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => {server.close(resolve);server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t, handler) {
  const dir = await mkdtemp(join(tmpdir(), "make-appearance-"));t.after(() => rm(dir,{recursive:true,force:true}));
  const store = new Store(dir);await store.init();
  const project = await store.createProject({name:"Visual fixture"}), design = new DesignStore(store), service = new AppearanceService(design);
  const calls = [];
  const base = await listen(t, createServer(async (req,res) => {
    const chunks = [];for await(const chunk of req) chunks.push(chunk);
    calls.push({url:req.url, headers:req.headers, body:Buffer.concat(chunks)});
    if(handler) return handler(req,res,calls);
    res.writeHead(200, {"Content-Type":"application/json"});res.end(JSON.stringify({data:[{b64_json:PNG.toString("base64")}]}));
  }));
  await store.saveConfig({revision:0, values:{imageBaseUrl:base+"/v1",imageModel:"offline-image",imageEditModel:"offline-edit",imageEditing:"true",baseUrl:base+"/v1",modelId:"offline-text"},imageApiKey:"secret-image-key"});
  t.after(() => service.shutdown());
  return {dir,store,project,design,service,calls};
}
const request = (extra={}) => ({title:"Arc",description:"A calm curved display body with a stable base",prompt:"A curved desktop terminal, matte shell, visible dial, front three-quarter studio view",contextIds:[],...extra});
async function generate(f, extra={}) {const e = await f.service.request(f.project.id,request(extra));await f.service.wait(e.id);return (await f.design.read(f.project.id)).context.entries.find(x=>x.id===e.id);}
async function confirm(f, e) {const gate=(await f.design.read(f.project.id)).context.entries.find(e=>e.id===APPEARANCE_GATE);return f.service.confirm(f.project.id,{optionId:e.id,revision:e.revision,gateRevision:gate.revision});}

test("image settings persist independently without exposing keys or making model requests", async t => {
  const f=await fixture(t);const config=await f.store.config();
  assert.equal(config.imageApiKeyConfigured,true);assert.equal(config.apiKeyConfigured,false);assert.doesNotMatch(JSON.stringify(config),/secret-image-key/);assert.equal(f.calls.length,0);
  const disk=await readFile(f.store.configFile,"utf8");assert.match(disk,/MAKE_IMAGE_MODEL="offline-image"/);assert.match(disk,/MAKE_IMAGE_API_KEY=/);
  await f.store.saveConfig({revision:config.revision,values:{imageQuality:"high"},imageApiKey:""});assert.equal((await f.store.privateConfig()).imageApiKey,"secret-image-key");
  await assert.rejects(f.store.saveConfig({revision:config.revision+1,values:{},imageApiKey:"x",clearImageApiKey:true}),/set and clear/);
  await f.store.saveConfig({revision:config.revision+1,values:{},clearImageApiKey:true});assert.equal((await f.store.config()).imageApiKeyConfigured,false);
});
test("visual generation, explicit approval and editing preserve version lineage and invalidate old approval", async t => {
  const f=await fixture(t), id=f.project.id;
  await f.service.ensureGate(id);await assert.rejects(f.service.assertApproved(id),/approval required/);
  const option=await generate(f);assert.equal(option.data.status,"succeeded");assert.ok(option.data.thumbnailId);assert.ok(option.data.imageId);assert.equal(f.calls.length,1);
  const body=JSON.parse(f.calls[0].body);assert.equal(body.model,"offline-image");assert.equal(body.n,1);assert.equal(f.calls[0].headers.authorization,"Bearer secret-image-key");
  await assert.rejects(f.service.assertApproved(id),/approval required/);
  await assert.rejects(f.design.patch(id,"user",{id:APPEARANCE_GATE}),/only be changed/);
  await confirm(f,option);await f.service.assertApproved(id);assert.equal(approvedAppearance((await f.design.read(id)).context.entries).id,option.id);
  const ref=await f.service.upload(id,PNG,"color");
  const revised=await generate(f,{parentId:option.id,parentRevision:option.revision,feedback:"Use a slimmer base",preserve:"Keep the screen, arc and dial",references:[{artifactId:ref.id,purpose:"color"}]});
  assert.equal(revised.data.directionId,option.data.directionId);assert.equal(revised.data.version,2);assert.equal(revised.data.parentId,option.id);assert.equal(revised.data.references.length,2);
  assert.match(f.calls[1].headers["content-type"],/multipart\/form-data/);assert.match(f.calls[1].body.toString(),/offline-edit/);assert.match(f.calls[1].body.toString(),/image\[\]/);assert.match(f.calls[1].body.toString(),/slimmer base/);
  await assert.rejects(f.service.assertApproved(id),/approval required/);await assert.rejects(confirm(f,option),/newest version/);
  await confirm(f,revised);await f.service.assertApproved(id);
  assert.equal((await f.design.read(id)).context.entries.filter(e=>e.data.kind==="appearance_option").length,2);
});
test("changed source constraints make approvals stale, including changes during generation", async t => {
  const f=await fixture(t),id=f.project.id;
  const p={id:"hardware.envelope",baseRevision:0,title:"Envelope",content:"A module envelope",data:{},dependsOn:[],artifactIds:[],status:"ready",reason:"Fixture"};
  await f.design.patch(id,"hardware",p);
  const option=await generate(f,{contextIds:[p.id]});await confirm(f,option);
  await f.design.patch(id,"hardware",{...p,baseRevision:1,content:"A larger module"},{[p.id]:1});
  await assert.rejects(f.service.assertApproved(id),/approval required/);
  const state=await f.design.read(id);assert.equal(state.context.entries.find(e=>e.id===APPEARANCE_GATE).status,"needs_review");
  await assert.rejects(confirm(f,state.context.entries.find(e=>e.id===option.id)),/changed/);
});
test("failed images retain completed alternatives, require explicit retry, and reject foreign references", async t => {
  const f=await fixture(t,(req,res,calls)=>{res.writeHead(calls.length===2?503:200,{"Content-Type":"application/json"});res.end(JSON.stringify({data:[{b64_json:PNG.toString("base64")}],error:"never expose provider body secret-image-key"}));});
  const first=await generate(f),second=await generate(f,{title:"Fold"});assert.equal(first.data.status,"succeeded");assert.equal(second.data.status,"failed");assert.doesNotMatch(second.data.error,/secret-image-key/);assert.equal(f.calls.length,2);
  const retry=await generate(f,{title:"Fold",retryOf:second.id});assert.equal(retry.data.status,"succeeded");assert.equal(retry.data.directionId,second.data.directionId);assert.equal(retry.data.version,second.data.version);assert.equal(retry.id,second.id);assert.equal(retry.data.attempts,2);assert.equal((await f.design.read(f.project.id)).context.entries.filter(e=>e.data.kind==="appearance_option").length,2);
  await assert.rejects(f.service.request(f.project.id,request({references:[{artifactId:"foreign-image",purpose:"detail"}]})),/Unknown image reference/);
  const config=await f.store.config();await f.store.saveConfig({revision:config.revision,values:{imageEditing:"false"}});
  await assert.rejects(f.service.request(f.project.id,request({parentId:first.id})),/editing disabled/);
  assert.throws(()=>imageBytes(Buffer.from("not image")),/PNG, JPEG/);
});
test("jobs are durable, cancellable, recovered without replay, and constrained by concurrency", async t => {
  const f=await fixture(t,(req,res)=>{setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({data:[{b64_json:PNG.toString("base64")}]}));}},150).unref();});
  const c=await f.store.config();await f.store.saveConfig({revision:c.revision,values:{imageConcurrency:"1"}});
  const first=await f.service.request(f.project.id,request()), second=await f.service.request(f.project.id,request({title:"Second"}));
  await f.service.cancel(f.project.id,second.id);await f.service.wait(first.id);
  const state=await f.design.read(f.project.id);assert.equal(state.context.entries.find(e=>e.id===second.id).data.status,"cancelled");assert.equal(f.calls.length,1);
  await f.design.change(f.project.id,d=>{const e=d.context.entries.find(e=>e.id===second.id);e.data.status="running";});
  await f.design.recover();const recovered=await new DesignStore(f.store).read(f.project.id);assert.equal(recovered.context.entries.find(e=>e.id===second.id).data.status,"interrupted");assert.equal(f.calls.length,1);
});
test("HTTP review is project-isolated and serves raster artifacts inline while blocking stale decisions", async t => {
  const f=await fixture(t),option=await generate(f);
  const runtime=new AgentRuntime(f.design,async()=>"unused"),base=await listen(t,createApp(f.store,undefined,{design:f.design,runtime}));
  const image=await fetch(`${base}/api/projects/${f.project.id}/artifacts/${option.data.imageId}`);assert.equal(image.status,200);assert.match(image.headers.get("content-disposition"),/^inline/);assert.equal(image.headers.get("content-type"),"image/png");
  const other=await f.store.createProject({name:"Other"});const foreign=await fetch(`${base}/api/projects/${other.id}/artifacts/${option.data.imageId}`);assert.equal(foreign.status,404);
  const gate=(await f.design.read(f.project.id)).context.entries.find(e=>e.id===APPEARANCE_GATE);
  const post=(path,body)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const approved=await post(`/api/projects/${f.project.id}/appearance/confirm`,{optionId:option.id,revision:option.revision,gateRevision:gate.revision});assert.equal(approved.status,200);
  assert.equal((await post(`/api/projects/${f.project.id}/appearance/confirm`,{optionId:option.id,revision:option.revision,gateRevision:gate.revision})).status,409);
  assert.equal((await post(`/api/projects/${other.id}/appearance/revise`,{optionId:option.id,revision:option.revision,feedback:"Change"})).status,404);
  const upload=await fetch(`${base}/api/projects/${f.project.id}/appearance/references?purpose=form`,{method:"POST",headers:{"Content-Type":"image/png"},body:PNG});assert.equal(upload.status,201);
  const raw=await fetch(`${base}/api/projects/${f.project.id}/appearance/references`,{method:"POST",body:"fake"});assert.equal(raw.status,400);
});
test("runtime rejects engineering before approval and allows concept tooling with Skill receipts", async t => {
  const f=await fixture(t);let phase="blocked";
  const runtime=new AgentRuntime(f.design,async options=>{
    const call=async(name,args)=>{const tool=options.tools.find(t=>t.name===name);assert.ok(tool);return tool.execute("test",args,options.signal,()=>{},{});};
    if(phase==="blocked") {
      const result=await call("cad_generate",{name:"box",recipeJson:JSON.stringify({geometry:{op:"box",size:[10,10,2]}})});assert.equal(result.isError,true);assert.match(result.content[0].text,/approval required/);
      await call("ask_user",{questions:[{question:"What product should we design?",inputType:"text"}]});return "Need a product brief";
    }
    const noSkill=await call("image_generate",request());assert.equal(noSkill.isError,true);
    assert.equal((await call("use_skill",{name:"make-appearance-prompting",rationale:"Create actual visual directions"})).isError,undefined);
    const generated=JSON.parse((await call("image_generate",request())).content[0].text);
    await call("appearance_status",{optionId:generated.optionId});
    await call("appearance_review",{optionIds:[generated.optionId]});return "Visual concepts are ready";
  });
  await runtime.appearance.ensureGate(f.project.id);
  let run=await runtime.start(f.project.id,{role:"mechanical",prompt:"Design a terminal"});await runtime.wait(run.id);
  assert.equal((await f.design.read(f.project.id)).runs[0].status,"awaiting_input");
  phase="concept";run=await runtime.start(f.project.id,{role:"mechanical",prompt:"Create concepts"});await runtime.wait(run.id);
  const state=await f.design.read(f.project.id);assert.equal(state.runs.at(-1).status,"awaiting_input");assert.ok(state.runs.at(-1).tasks[0].knowledge.skills.some(s=>s.name==="make-appearance-prompting"));assert.equal(state.context.entries.filter(e=>e.data.kind==="appearance_option").length,1);
  await runtime.shutdown();
});

test("appearance continuation inherits answers and engineering outputs bind approval", async t => {
  const f=await fixture(t);let phase="question";
  const runtime=new AgentRuntime(f.design,async options=>{
    const call=async(name,args)=>{const result=await options.tools.find(t=>t.name===name).execute("test",args,options.signal,()=>{},{});assert.ok(!result.isError,result.content[0].text);return JSON.parse(result.content[0].text);};
    if(phase==="question") {await call("ask_user",{questions:[{question:"Which shell material?",inputType:"text"}]});return "Need material";}
    assert.match(options.prompt,/PLA confirmed/);
    if(phase==="concept") {
      await call("use_skill",{name:"make-appearance-prompting",rationale:"Create the user review image"});
      const job=await call("image_generate",request());await call("appearance_status",{optionId:job.optionId});await call("appearance_review",{optionIds:[job.optionId]});return "Concept ready";
    }
    const cad=await call("cad_generate",{name:"approved_plate",recipeJson:JSON.stringify({geometry:{op:"box",size:[12,12,2]}})});
    await call("context_update",{id:"mechanical.approved-part",baseRevision:0,title:"Approved part",content:"Editable plate",dataJson:"{}",dependsOn:[],artifactIds:[cad.mesh.id],status:"ready",reason:"Save approved work"});return "Saved CAD";
  });
  await runtime.appearance.ensureGate(f.project.id);
  let run=await runtime.start(f.project.id,{role:"mechanical",prompt:"Design a terminal"});await runtime.wait(run.id);
  const question=(await f.design.read(f.project.id)).context.entries.find(e=>e.data.kind==="question");
  phase="concept";run=await runtime.start(f.project.id,{role:"mechanical",prompt:"Design a terminal",resumedFrom:run.id,userAnswers:[{entryId:question.id,revision:question.revision,answer:"PLA confirmed"}]});await runtime.wait(run.id);
  const snapshot=await f.design.read(f.project.id),concept=snapshot.context.entries.find(e=>e.data.kind==="appearance_option"),gate=snapshot.context.entries.find(e=>e.id===APPEARANCE_GATE);
  await runtime.appearance.confirm(f.project.id,{optionId:concept.id,revision:concept.revision,gateRevision:gate.revision});
  phase="engineering";run=await runtime.start(f.project.id,{role:"mechanical",prompt:"Design a terminal",resumedFrom:run.id});await runtime.wait(run.id);
  const state=await f.design.read(f.project.id);assert.equal(state.runs.at(-1).status,"completed",state.runs.at(-1).error);
  assert.ok(state.context.entries.find(e=>e.id==="mechanical.approved-part").dependsOn.includes(APPEARANCE_GATE));
  assert.ok(state.context.artifacts.find(a=>a.name==="approved_plate.stl").inputRevisions[APPEARANCE_GATE]);await runtime.shutdown();
});

test("pending image jobs block directory changes and stale generation inputs cannot be approved", async t => {
  let release,started;const waiting=new Promise(resolve=>{release=resolve;}),requestStarted=new Promise(resolve=>{started=resolve;});
  const f=await fixture(t,async(req,res)=>{started();await waiting;res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({data:[{b64_json:PNG.toString("base64")}]}));});
  const patch={id:"hardware.screen",baseRevision:0,title:"Screen",content:"Small screen",data:{},dependsOn:[],artifactIds:[],status:"ready",reason:"Fixture"};await f.design.patch(f.project.id,"hardware",patch);
  const job=await f.service.request(f.project.id,request({contextIds:[patch.id]}));await requestStarted;
  try {
    await assert.rejects(f.store.updateProject(f.project.id,{name:"Renamed",updatedAt:f.project.updatedAt}),/image jobs/);
    await assert.rejects(f.store.deleteProject(f.project.id,{updatedAt:f.project.updatedAt}),/image jobs/);
    await f.design.patch(f.project.id,"hardware",{...patch,baseRevision:1,content:"Larger screen"},{[patch.id]:1});
  } finally {release();}
  await f.service.wait(job.id);
  const result=(await f.design.read(f.project.id)).context.entries.find(e=>e.id===job.id);assert.equal(result.data.status,"failed");assert.notEqual(result.status,"ready");
});


test("failed images retry during an active run and duplicate submissions are rejected", async t => {
  const f = await fixture(t, (req, res, calls) => {
    res.writeHead(calls.length === 1 ? 503 : 200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({data: [{b64_json: PNG.toString("base64")}]}));
  });
  const failed = await generate(f);
  assert.equal(failed.data.status, "failed");
  await f.design.change(f.project.id, d => d.runs.push({id: "active-fixture", projectId: f.project.id, status: "running", tasks: [], events: []}));
  const runtime = new AgentRuntime(f.design, async () => "unused");
  t.after(() => runtime.shutdown());
  const base = await listen(t, createApp(f.store, undefined, {design: f.design, runtime}));
  const retry = () => fetch(`${base}/api/projects/${f.project.id}/appearance/retry`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({optionId: failed.id, revision: failed.revision})});
  const response = await retry();
  assert.equal(response.status, 202, await response.clone().text());
  const attempt = await response.json();
  assert.equal(attempt.id, failed.id);
  assert.equal(attempt.data.version, failed.data.version);
  await runtime.appearance.wait(attempt.id);
  assert.equal((await f.design.read(f.project.id)).context.entries.find(e => e.id === attempt.id).data.status, "succeeded");
  assert.equal((await retry()).status, 409);
  assert.equal(f.calls.length, 2);
});
