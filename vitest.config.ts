/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { defineConfig, type Plugin } from 'vitest/config'

const isCI = !!process.env.CI

/**
 * Test-only Vite plugin that injects `/* @vite-ignore *\/` hints into a small,
 * explicit allow-list of dynamic `import()` call sites.
 *
 * Why: Vite's static analyzer warns/errors on variable-driven dynamic imports
 * (e.g. `import(\`../data/${provider}/index.js\`)`), which is fine at runtime in
 * production (Node resolves these normally) but fails during Vitest's Vite-based
 * transform. Rather than polluting production source with `@vite-ignore` pragmas
 * that have no meaning outside the test runner, we rewrite the call sites here
 * during the test transform only.
 *
 * The transform is tightly scoped to specific files + specific expressions so it
 * will not silently swallow new dynamic imports added elsewhere.
 */
function injectViteIgnoreForTests(): Plugin {
  // Each entry: file path suffix + the exact `import(...)` expression to prefix
  // with the ignore hint. Using exact matches (not broad regex) keeps the
  // rewrite auditable and prevents accidental repo-wide edits.
  const targets: { fileSuffix: string; find: string; replace: string }[] = [
    {
      fileSuffix: 'src/factories/DbCreatorFactory.ts',
      find: 'await import(\n        `../data/${Environment.Config.db_provider}/index.js`\n      )',
      replace:
        'await import(\n        /* @vite-ignore */\n        `../data/${Environment.Config.db_provider}/index.js`\n      )'
    },
    {
      fileSuffix: 'src/factories/SecretManagerCreatorFactory.ts',
      find: 'await import(\n        `../secrets/${Environment.Config.secrets_provider}/index.js`\n      )',
      replace:
        'await import(\n        /* @vite-ignore */\n        `../secrets/${Environment.Config.secrets_provider}/index.js`\n      )'
    },
    {
      fileSuffix: 'src/Index.ts',
      find: 'await import(fileURL.href)',
      replace: 'await import(/* @vite-ignore */ fileURL.href)'
    }
  ]

  return {
    name: 'rps-test-only-inject-vite-ignore',
    enforce: 'pre',
    transform(code, id) {
      // Normalize to posix separators so the suffix check works on Windows too.
      const normalized = id.replace(/\\/g, '/')
      const target = targets.find((t) => normalized.endsWith(t.fileSuffix))
      if (target == null) return null
      if (!code.includes(target.find)) return null
      return {
        code: code.replace(target.find, target.replace),
        map: null
      }
    }
  }
}

export default defineConfig({
  plugins: [injectViteIgnoreForTests()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Mirror jest's moduleDirectories: ['node_modules', 'src']
    // Vitest uses Vite resolution; tests import via explicit relative paths,
    // so no alias remapping is required for the current test suite.
    reporters: isCI ? [
          'default',
          'junit',
          'github-actions'
        ] : ['default'],
    outputFile: {
      junit: 'junit.xml'
    },
    coverage: {
      provider: 'v8',
      reporter: [
        'text',
        'lcov',
        'cobertura',
        'html'
      ],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{js,ts}'],
      exclude: [
        'src/middleware/custom/**/*.{js,ts}',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/test/**'
      ]
    }
  }
})
