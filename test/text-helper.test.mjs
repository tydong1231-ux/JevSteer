import test from "node:test";
import assert from "node:assert/strict";
import { parseFieldText, generateFieldText } from "../src/text-helper.mjs";

test("text generator accepts only a single JSON text field or null", () => {
  assert.equal(parseFieldText({choices:[{message:{content:'{"text":"London"}'}}]}), "London");
  assert.equal(parseFieldText({choices:[{message:{content:'{"text":null}'}}]}), null);
  for (const content of ['{"text":42}', '{"text":"London","action":"click"}', 'London']) {
    assert.throws(() => parseFieldText({choices:[{message:{content}}]}), /invalid|non-JSON/);
  }
});

test("text generator does not call provider when not configured", async () => {
  assert.deepEqual(
    await generateFieldText({goal:"Find flights",field:{},page:{}},{apiKey:""}),
    {status:"not_configured",text:null}
  );
});

test("text generator sends field context, not arbitrary browser commands", async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url,opts) => {
    sent = { url,headers:opts.headers,body:JSON.parse(opts.body) };
    return new Response(JSON.stringify({choices:[{message:{content:'{"text":"Zurich"}'}}]}),{status:200});
  };
  try {
    const result = await generateFieldText({
      goal:"From Zurich to London", field:{label:"Origin",role:"textbox"}, page:{title:"Flights",text:"Where from?"}
    },{apiKey:"test",endpoint:"https://provider.example/v1",model:"small"});
    assert.equal(result.text,"Zurich");
    assert.equal(sent.url,"https://provider.example/v1/chat/completions");
    assert.equal(sent.headers.Authorization,"Bearer test");
    assert.equal(JSON.parse(sent.body.messages[1].content).field.label,"Origin");
  } finally { globalThis.fetch = original; }
});
