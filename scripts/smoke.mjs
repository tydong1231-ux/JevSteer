import { JevSteerRuntime } from "../src/runtime.mjs";

const runtime = new JevSteerRuntime();
try {
  console.log(JSON.stringify(await runtime.doctor(), null, 2));
} finally {
  await runtime.close();
}
