import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/contract/**/*.test.ts'],
    globals: true,
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      obsidian: resolve(__dirname, 'test/__mocks__/obsidian.ts'),
    },
  },
})
