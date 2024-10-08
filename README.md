# any-xray

X-Ray vision for pesky `any` types.

## Features

Dangerous `any` types can come from surprising places in TypeScript. This VS Code extension makes all identifiers with an `any` type stand out.

![Screenshot of any-xray in action, showing symbols with any types in red](/screenshot.png)

## Extension Settings

`anyXray.anyStyle`

Change the way that symbols with `any` types are rendered. You can pass in anything assignable to [`DecorationRenderOptions`][style]. The default is:

```json
{
  "backgroundColor": "rgba(255,0,0,0.1)",
  "borderRadius": "3px",
  "border": "solid 1px rgba(255,0,0)",
  "color": "red"
}
```

## Related work

- If you want `any` types to be compiler warnings, check out [type-coverage].
- You may also be interested in typescript-eslint's [no-unsafe-assignment] rule, which is part of the [recommended-type-checked] configuration.

## How this works

This extension piggybacks on the "quickinfo" (hovertext) provided by the TypeScript Language Service in VS Code. It parses your TypeScript file and asks VS Code for quickinfo on all the identifiers in the visible range of active editors. If these end with something like ": any", then it colors them red.

There are a few situations in which this will highlight identifiers that are safe, see [#1](https://github.com/danvk/any-xray/issues/1).

[type-coverage]: https://github.com/plantain-00/type-coverage
[no-unsafe-assignment]: https://typescript-eslint.io/rules/no-unsafe-assignment/
[recommended-type-checked]: https://typescript-eslint.io/users/configs/#recommended-type-checked
[style]: https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions
