---
"@stratakit/foundations": patch
---

Fixed `Root` leaving behind its `@layer reset` `<style>` element after unmounting, and adding duplicates when multiple `Root`s share a root node.
