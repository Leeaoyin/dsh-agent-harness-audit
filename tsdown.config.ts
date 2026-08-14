import { defineConfig } from 'tsdown'

// Self-contained: transpiles src/ directly, without project references or
// type checking, so a git install's `prepare` script works outside a monorepo
// checkout (docs/user/develop/basic/publish.zh.md).
//
// `dts: false` is deliberate. Declaration output would have to resolve the
// `@deepseek-ai/*` peer types, which are NOT installed when pnpm runs
// `prepare` for a git dependency — emitting them would make the install fail
// on exactly the path this config exists to support. Nothing imports this
// package's types; the loader imports its `apply`.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  dts: false,
  clean: true,
})
