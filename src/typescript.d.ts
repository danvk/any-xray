import 'typescript';

// This is cribbed from https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/type-utils/typings/typescript.d.ts
declare module 'typescript' {
  interface Type {
    /**
     * If the type is `any`, and this is set to "error", then TS was unable to resolve the type
     */
    intrinsicName?: string;
  }
}
