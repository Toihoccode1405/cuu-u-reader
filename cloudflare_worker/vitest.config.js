import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Khóa và cờ chỉ dùng cho test, không liên quan môi trường thật
        bindings: {
          JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
          ALLOW_REGISTRATION: 'true',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.js'],
  },
});
