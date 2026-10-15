# Third-party notices

This project is an independent integration built around two open-source ideas/tools:

1. **Jev Browser** by Ying-Kai Liao
   - Repository: https://github.com/Ying-Kai-Liao/jev-browser
   - License: MIT
   - This project adapts concepts from its Jev decision loop, completion checks,
     ambiguity handling, and irreversible-action guard. The browser driver here
     is independently implemented with native Playwright and legacy Kapture adapters.

2. **Kapture** by William Kapke
   - Repository: https://github.com/williamkapke/kapture
   - License: MIT
   - Used as an npm dependency (`kapture-mcp`) and as the browser control layer.

TypeSafe Jev is accessed through TypeSafe's hosted System One API and is not
redistributed by this repository.

3. **Playwright** by Microsoft and contributors
   - Repository: https://github.com/microsoft/playwright
   - License: Apache-2.0
   - `playwright-core` is a runtime dependency; `@playwright/test` is a development
     dependency. Their upstream license/notice files remain in the packages.

The tontoko Jev Browser SDK v0.16.0 (Apache-2.0, revision
7d6335935043c680a005733b3bbf61af5c675ec5) was reviewed for the driver decision.
No source files from it or Sedum were copied in this migration. The new snapshot,
session, events and driver modules are independently authored; see ADR 001.
