# Change Log

## 0.3.0

- Support Vue files with `<script lang="ts">`. (#23)
- Don't report "any" types that overlap with TypeScript errors. (#24)
- Suppress warnings on destructuring assignment and "evolving any". (#26)
- Change default style to be a little less aggressive. (#25)

## 0.2.1

- Limit the work that `@babel/traverse` does; net effect is a speedup and the ability to run on the Mt. Everest of TypeScript, `checker.ts`. (#21)
- Cache the AST for the active document to avoid re-parsing.

## 0.2.0

- Re-architected to use VS Code's built-in TypeScript server (thanks for the tip @acutmore!).
- Added an icon (thanks ChatGPT!)
- Removed `anyXray.renderErrorAnys` setting, which no longer makes sense in the new architecture.
- Switched from TypeScript -> Babel for parsing. This results in a significantly smaller extension.

## 0.1.1

- Reduce VS Code requirement to support Cursor

## 0.1.0

- Initial release ([tweet])

[tweet]: https://twitter.com/danvdk/status/1840509263908831457
