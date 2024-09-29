# any-xray

X-Ray vision for pesky `any` types.

## Features

Dangerous `any` types can come from surprising places in TypeScript. This VS Code extension makes all identifiers with an `any` type stand out.

![Screenshot of any-xray in action, showing symbols with any types in red](/screenshot.png)

## Extension Settings

No settings for now.

## Related work

- If you want `any` types to be compiler warnings, check out [type-coverage].
- You may also be interested in typescript-eslint's [no-unsafe-assignment] rule, which is part of the [recommended-type-checked] configuration.

[type-coverage]: https://github.com/plantain-00/type-coverage
[no-unsafe-assignment]: https://typescript-eslint.io/rules/no-unsafe-assignment/
[recommended-type-checked]: https://typescript-eslint.io/users/configs/#recommended-type-checked
