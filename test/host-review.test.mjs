import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {HostReviewStore} from "../src/host-review.mjs";
import {MemoryKapture,memoryRuntime,scriptedDecider,decision} from "./helpers/runtime.mjs";

const ready = {tool:"none",done:0.99};
const options = {verificationMode:"host",evidenceLevel:"none",successCriteria:["Correct record is visible"],assertions:[{type:"text_contains",value:"REF-42"}],constraints:["Read only"]};
function fixture() {const k=new MemoryKapture({text:"REF-42",elements:[]});return {k,r:memoryRuntime(k,scriptedDecider([ready]))};}
function proof(result, decision="accept") {return {tabId:"test",reviewId:result.host_review.review_id,decision,goalEvidence:"Observed REF-42",criteriaEvidence:["REF-42 is visible in the current record"],constraintsEvidence:"No record inputs or saves were dispatched"};}

test("host mode returns evidence without calling Jev as the final verifier or claiming success",async()=>{
 const {r}=fixture();const result=await r.run("Inspect REF-42",options);
 assert.equal(result.status,"host_review_required");assert.equal(result.jev_calls,1);
 assert.equal(result.verification.observation.text,"REF-42");
 assert.equal(result.host_review.state,"pending");
 const receipt=await r.reviewResult(proof(result));
 assert.equal(receipt.status,"completed_host_verified");assert.equal(receipt.browser_actions,0);
 const repeated=await r.run("Inspect REF-42",{...options,runId:result.run_id});
 assert.equal(repeated.status,"completed_host_verified");assert.equal(repeated.actions.length,0);
});

test("failed deterministic assertions cannot be overridden by host mode",async()=>{
 const {r}=fixture();const result=await r.run("Inspect REF-99",{...options,assertions:[{type:"text_contains",value:"REF-99"}]});
 assert.equal(result.status,"verification_failed");assert.equal(await r.reviews.pending("test"),undefined);
});

test("review binds to post-capture state and rechecks assertions after capture cleanup",async()=>{
 for(const text of ["REF-42 settled","REF-99"]){
  const {r,k}=fixture();r.finishNetworkCapture=async()=>{k.page.text=text;return {available:false};};
  const result=await r.run("Inspect REF-42",options);
  assert.equal(result.verification.observation.text,text);
  if(text.includes("REF-42")) assert.equal((await r.reviewResult(proof(result))).status,"completed_host_verified");
  else {assert.equal(result.status,"verification_failed");assert.equal(await r.reviews.pending("test"),undefined);}
 }
});

test("ticket and acceptance reproduce capture visibility and always clean up inspection",async()=>{
 const {r,k}=fixture();let attached=0;
 r.startNetworkCapture=async()=>{attached++;k.page.text="REF-42 captured";return {available:true};};
 r.finishNetworkCapture=async()=>{attached--;k.page.text="REF-42 uncaptured";return {available:true};};
 const result=await r.run("Inspect REF-42",options);
 assert.equal(result.verification.observation.text,"REF-42 captured");assert.equal(attached,0);
 assert.equal((await r.reviewResult(proof(result))).status,"completed_host_verified");assert.equal(attached,0);
});

test("passed host assertions pause for review even if Jev wants extra input",async()=>{
 const k=new MemoryKapture({text:"REF-42",elements:[{i:0,tag:"button",role:"button",label:"Remove",selector:"#remove"}]});
 const r=memoryRuntime(k,scriptedDecider([{tool:"click",target:0,done:0.01}]));
 const result=await r.run("Inspect REF-42",options);
 assert.equal(result.status,"host_review_required");assert.equal(k.commands.length,0);
 assert.equal(result.host_review.state,"pending");
});

test("a delayed remote result is passively observed without replaying input or auto-accepting",async()=>{
 const k=new MemoryKapture({text:"Pending",elements:[{i:0,tag:"button",role:"button",label:"Generate",selector:"#generate"}]});
 const r=memoryRuntime(k,scriptedDecider([{tool:"click",target:0,side_effect:0.8},()=>{k.page.text="REF-42";return decision({tool:"none",done:0.01});}]));
 r.observation={maxMs:5,quietMs:0,pollMs:1};
 const result=await r.run("Generate and inspect REF-42",options);
 assert.equal(result.status,"host_review_required");assert.equal(k.commands.filter(c=>c.command==="click").length,1);
 assert.equal((await r.journal.pending("test")).length,1);
 assert.equal((await r.reviewResult(proof(result))).status,"completed_host_verified");
});

test("passive result waits are bounded and never accept a missing or busy outcome",async()=>{
 for(const busy of [false,true]){
  const k=new MemoryKapture({text:"Pending",elements:[{i:0,tag:"button",role:"button",label:"Generate",selector:"#generate"}]});
  const r=memoryRuntime(k,scriptedDecider([{tool:"click",target:0,side_effect:0.8},()=>{if(busy){k.page.text="REF-42";k.page.loading={busy:true};}return decision({tool:"none",done:0.01});}]));
  r.observation={maxMs:5,quietMs:0,pollMs:1};
  const result=await r.run("Generate REF-42",options);
  assert.equal(result.status,"stuck");assert.equal(await r.reviews.pending("test"),undefined);
  assert.equal((await r.journal.pending("test")).length,1);assert.equal(k.commands.filter(c=>c.command==="click").length,1);
 }
});

test("empty or failed assertions cannot create an early host checkpoint",async()=>{
 for(const assertions of [[],[{type:"text_contains",value:"Missing"}]]){
  const k=new MemoryKapture({text:"REF-42"});const r=memoryRuntime(k,scriptedDecider([{tool:"wait",done:0.01}]));
  r.act=async()=>{};
  const result=await r.run("Inspect",{...options,assertions,maxActions:1});
  assert.notEqual(result.status,"host_review_required");assert.equal(await r.reviews.pending("test"),undefined);
 }
});

test("a pending review blocks another run, manual input and navigation",async()=>{
 const {r,k}=fixture();const result=await r.run("Inspect REF-42",options);
 const next=await r.run("Unrelated task",{runId:"new-run",verificationMode:"jev",evidenceLevel:"none"});
 assert.equal(next.host_review.review_id,result.host_review.review_id);assert.equal(next.run_id,result.run_id);
 assert(!JSON.stringify(next.evidence).includes("Unrelated task"));assert.equal(next.plan_goal,undefined);
 assert.equal(next.milestone.id,result.host_review.milestone_id);assert.match(next.review_context,/originating/);
 await assert.rejects(r.actManual({tabId:"test",action:"scroll"}),/HOST_REVIEW_PENDING/);
 const opened=await r.open("https://fixture.test/elsewhere",{tabId:"test",newTab:false});
 assert.equal(opened.status,"host_review_required");assert.equal(k.commands.length,0);
});

test("acceptance requires every criterion and constraint, and changed pages cannot be accepted",async()=>{
 const {r,k}=fixture();const result=await r.run("Inspect REF-42",options);
 await assert.rejects(r.reviewResult({...proof(result),criteriaEvidence:[]}),/ALL_CRITERIA/);
 await assert.rejects(r.reviewResult({...proof(result),constraintsEvidence:""}),/ALL_CRITERIA/);
 k.page.text="REF-99";
 assert.equal((await r.reviewResult(proof(result))).status,"host_review_stale");
 assert.equal((await r.reviews.pending("test")).state,"pending");
 const rejected=await r.reviewResult(proof(result,"reject"));
 assert.equal(rejected.status,"host_review_rejected");assert.equal(await r.reviews.pending("test"),undefined);
});

test("host review persists across runtime restarts without storing raw page or evidence",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jev-review-"));
 try {
  const {r,k}=fixture();r.reviews=new HostReviewStore({dir});
  const result=await r.run("Inspect REF-42",options);
  const stored=await readFile(r.reviews.path("test"),"utf8");assert(!stored.includes("REF-42"));
  const resumed=memoryRuntime(k,scriptedDecider([ready]));resumed.reviews=new HostReviewStore({dir});
  const gate=await resumed.run("New run cannot bypass review",{verificationMode:"host",evidenceLevel:"none"});
  assert.equal(gate.host_review.review_id,result.host_review.review_id);
  assert.equal((await resumed.reviewResult(proof(result))).status,"completed_host_verified");
  const after=await readFile(r.reviews.path("test"),"utf8");assert(!after.includes("Observed REF-42"));
 } finally {await rm(dir,{recursive:true,force:true});}
});

test("rejecting a review never clears unresolved remote mutations",async()=>{
 const {r,k}=fixture();const result=await r.run("Inspect REF-42",options);
 await r.journal.begin("test",{runId:result.run_id,milestoneId:"main",action:{tool:"click",el:{tag:"button",label:"Save"}},page:k.page,remoteRisk:1});
 await r.reviewResult(proof(result,"reject"));assert.equal((await r.journal.pending("test")).length,1);
});

test("host acceptance resolves only originating milestone actions and retains remote replay guards",async()=>{
 const {r,k}=fixture();const result=await r.run("Inspect REF-42",options);
 const mutation={tool:"click",el:{tag:"button",label:"Save"}};
 const ticket=await r.reviews.pending("test");
 await r.journal.begin("test",{runId:result.run_id,milestoneId:"main",action:mutation,page:k.page,remoteRisk:1,contractDigest:ticket.contract_digest});
 await r.journal.begin("test",{runId:"other-run",milestoneId:"other",action:{tool:"click",el:{tag:"button",label:"Other save"}},page:k.page,remoteRisk:1});
 await r.reviewResult(proof(result));
 assert.equal((await r.journal.pending("test")).length,1);assert(await r.journal.replayProtected("test",mutation,k.page));
});

test("reusing run and milestone IDs for a different contract cannot clear an unknown action",async()=>{
 const {r,k}=fixture();
 const unknown=await r.journal.begin("test",{runId:"shared-run",milestoneId:"main",action:{tool:"click",el:{tag:"button",label:"Save"}},page:k.page,remoteRisk:1,intent:"Save the original bill",contractDigest:"original-contract"});
 const inspected=await r.run("Inspect REF-42",{...options,runId:"shared-run"});
 assert.equal(inspected.status,"host_review_required");
 await r.reviewResult(proof(inspected));
 assert.deepEqual((await r.journal.pending("test")).map(x=>x.id),[unknown.id]);
});

test("an old journal without a contract digest requires explicit outcome resolution",async()=>{
 const {r,k}=fixture();const result=await r.run("Inspect REF-42",options);
 const unknown=await r.journal.begin("test",{runId:result.run_id,milestoneId:"main",action:{tool:"click",el:{tag:"button",label:"Save"}},page:k.page,remoteRisk:1});
 await r.reviewResult(proof(result));
 assert.deepEqual((await r.journal.pending("test")).map(x=>x.id),[unknown.id]);
});

test("weaker criteria under the same goal and IDs cannot certify an earlier contract",async()=>{
 const {r,k}=fixture();const initial=await r.run("Inspect REF-42",{...options,runId:"same-goal"});
 const ticket=await r.reviews.pending("test");
 await r.reviewResult(proof(initial,"reject"));
 const unknown=await r.journal.begin("test",{runId:initial.run_id,milestoneId:"main",action:{tool:"click",el:{tag:"button",label:"Save"}},page:k.page,remoteRisk:1,contractDigest:ticket.contract_digest});
 const weakened=await r.run("Inspect REF-42",{...options,runId:initial.run_id,assertions:[{type:"text_contains",value:"REF"}]});
 const receipt=await r.reviewResult(proof(weakened));
 assert.deepEqual(receipt.pending_actions.map(x=>x.action_id),[unknown.id]);
 assert.deepEqual((await r.journal.pending("test")).map(x=>x.id),[unknown.id]);
});

test("automatic verification also preserves unknown actions from a different contract",async()=>{
 const {r,k}=fixture();
 const unknown=await r.journal.begin("test",{runId:"shared-auto",milestoneId:"main",action:{tool:"click",el:{tag:"button",label:"Save"}},page:k.page,remoteRisk:1,contractDigest:"original-contract"});
 const result=await r.run("Inspect REF-42",{...options,runId:"shared-auto",verificationMode:"jev"});
 assert.equal(result.status,"completed_verified");
 assert.deepEqual(result.pending_actions.map(x=>x.action_id),[unknown.id]);
 assert.deepEqual((await r.journal.pending("test")).map(x=>x.id),[unknown.id]);
});

test("host-required milestones cannot advance until accepted",async()=>{
 const {r,k}=fixture();const milestones=[{id:"first",goal:"Inspect REF-42",success_criteria:["Correct record is visible"],assertions:options.assertions},{id:"second",goal:"Inspect again",assertions:options.assertions}];
 const first=await r.run("Two stages",{verificationMode:"host",milestones,evidenceLevel:"none"});
 const blocked=await r.run("Two stages",{verificationMode:"host",milestones,milestoneIndex:1,runId:first.run_id,evidenceLevel:"none"});
 assert.equal(blocked.milestone_index,0);assert.equal(blocked.host_review.review_id,first.host_review.review_id);
 const accepted=await r.reviewResult({...proof(first),constraintsEvidence:undefined});assert.equal(accepted.next_milestone_index,1);
 const second=await r.run("Two stages",{verificationMode:"host",milestones,milestoneIndex:1,runId:first.run_id,evidenceLevel:"none"});
 assert.equal(second.status,"host_review_required");assert.equal(second.milestone_index,1);assert.equal(k.commands.length,0);
});

test("hybrid uncertainty goes to host but hard semantic failure remains a failure",async()=>{
 for(const score of [0.6,0.1]){const k=new MemoryKapture({text:"REF-42"});const r=memoryRuntime(k,scriptedDecider([ready],{verifyScore:score}));const result=await r.run("Inspect",{...options,verificationMode:"hybrid"});assert.equal(result.status,score===0.6?"host_review_required":"verification_failed");}
});

test("host mode cannot convert a CAPTCHA or login stop into an accepted review",async()=>{
 for(const scores of [{blocked:0.99},{login:0.99}]){const k=new MemoryKapture({text:"REF-42"});const r=memoryRuntime(k,scriptedDecider([{...ready,...scores}]));const result=await r.run("Inspect",options);assert(["blocked","needs_login"].includes(result.status));assert.equal(await r.reviews.pending("test"),undefined);}
});
