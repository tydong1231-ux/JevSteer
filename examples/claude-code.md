# Claude Code local MCP example

After publishing this package to npm:

```bash
claude mcp add jevsteer -e TYPESAFE_API_KEY="$TYPESAFE_API_KEY" -- npx -y jevsteer
```

For a local clone instead:

```bash
cd /path/to/jevsteer
npm install
claude mcp add jevsteer -e TYPESAFE_API_KEY="$TYPESAFE_API_KEY" -- node /absolute/path/to/jevsteer/bin/jevsteer.mjs
```

Then open Chrome, install/enable Kapture, and click the Kapture toolbar icon on the tab you want controlled.
