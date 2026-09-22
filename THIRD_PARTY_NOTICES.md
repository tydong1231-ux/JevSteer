# Third-party notices

This project is an independent integration built around two open-source ideas/tools:

1. **Jev Browser** by Ying-Kai Liao
   - Repository: https://github.com/Ying-Kai-Liao/jev-browser
   - License: MIT
   - This project adapts concepts from its Jev decision loop, completion checks,
     ambiguity handling, and irreversible-action guard. The browser driver here
     is independently implemented for Kapture instead of Playwright.

2. **Kapture** by William Kapke
   - Repository: https://github.com/williamkapke/kapture
   - License: MIT
   - Used as an npm dependency (`kapture-mcp`) and as the browser control layer.

TypeSafe Jev is accessed through TypeSafe's hosted System One API and is not
redistributed by this repository.
