import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

async function renderer(t) {
  const dir=await mkdtemp(join(tmpdir(),"make-review-render-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const outfile=join(dir,"review.cjs");
  await build({stdin:{contents:`import React from "react"; import {renderToStaticMarkup} from "react-dom/server";import {DesignReviewCard} from "./apps/web/src/components/DesignReviewCard.tsx";export const render=props=>renderToStaticMarkup(React.createElement(DesignReviewCard,props));`,resolveDir:resolve(".")},bundle:true,platform:"node",format:"cjs",jsx:"automatic",outfile,logLevel:"silent"});
  return (await import(pathToFileURL(outfile).href)).default.render;
}
const option=(id,title,extra={})=>({id:`appearance.option.${id}`,title,revision:3,status:"ready",content:`${title} proportions and controls`,data:{kind:"appearance_option",directionId:id,version:1,status:"succeeded",imageId:`image-${id}`,thumbnailId:`thumb-${id}`,runId:"run-a",inputRevisions:{},...extra}});
const props=entries=>({projectId:"project-a",entries,runId:"run-a",visibleRunIds:["run-a"],disabled:false,t:(_zh,en)=>en,onChange:()=>{},onContinue:async()=>{},onExplore:async()=>{}});
test("graphical review renders three distinct inline image choices and a separate explicit approval action",async t=>{
  const render=await renderer(t),html=render(props([option("arc","Arc"),option("fold","Fold"),option("pebble","Pebble")]));
  assert.equal((html.match(/class="concept-option /g)||[]).length,3);
  for(const id of ["arc","fold","pebble"])assert.match(html,new RegExp(`/api/projects/project-a/artifacts/thumb-${id}`));
  assert.equal((html.match(/class="concept-card-select"/g)||[]).length,3);assert.doesNotMatch(html,/Select<\/button>/);assert.equal((html.match(/class="secondary concept-refine-button"/g)||[]).length,3);assert.match(html,/Approve and continue/);assert.match(html,/disabled=""[^>]*><svg[^]*?Approve and continue/);assert.doesNotMatch(html,/type="radio"/);assert.match(html,/Concept visualization/);
});
test("retained versions show the newest preview with history and old-run concepts remain visible",async t=>{
  const render=await renderer(t),old=option("arc","Arc"),next=option("arc","Arc refined",{version:2,parentId:old.id});next.id="appearance.option.arc-v2";
  const p=props([old,next]);let html=render(p);assert.equal((html.match(/class="concept-option /g)||[]).length,1);assert.match(html,/Version history/);assert.match(html,/Compare/);
  html=render({...p,runId:undefined,visibleRunIds:[]});assert.match(html,/Arc refined/);
  html=render({...p,runId:"other-run"});assert.equal(html,"");
});


test("failed image retry stays enabled while orchestration locks review actions", async t => {
  const render = await renderer(t);
  for (const status of ["failed", "cancelled", "interrupted"]) {
    const html = render({...props([option("arc", "Arc", {status, imageId: undefined, thumbnailId: undefined})]), disabled: true});
    const retry = html.match(/<button[^>]*>Retry<\/button>/)?.[0];
    assert.ok(retry, `${status} has a retry button`);
    assert.doesNotMatch(retry, /disabled=/);
  }
});


test("a direction stays in its original conversation when another run produces a new version", async t => {
  const render = await renderer(t);
  const first = option("arc", "Arc", {status: "failed", imageId: undefined, thumbnailId: undefined});
  const next = option("arc", "Arc updated", {version: 2, runId: "run-b", status: "running", imageId: undefined, thumbnailId: undefined});
  next.id = "appearance.option.arc-v2";
  const p = {...props([first, next]), visibleRunIds: ["run-a", "run-b"]};
  const original = render(p);
  assert.equal((original.match(/class="concept-option /g) || []).length, 1);
  assert.match(original, /Arc updated/);
  assert.match(original, /Generating/);
  assert.equal(render({...p, runId: "run-b"}), "");
  assert.equal(render({...p, runId: undefined}), "");
  assert.match(render({...p, runId: undefined, visibleRunIds: ["run-b"]}), /Arc updated/);
});
