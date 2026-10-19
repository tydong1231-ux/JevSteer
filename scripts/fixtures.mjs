import { startFixtureServer } from "../test/helpers/fixture-server.mjs";
const fixture = await startFixtureServer({ port: Number(process.env.JEVSTEER_FIXTURE_PORT || 61823) });
console.log(`Local test scenarios: ${fixture.base}`);
