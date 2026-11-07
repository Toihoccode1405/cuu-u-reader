import { defineConfig } from '@playwright/test';

const PORT = 8791;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Dùng Chrome đã cài sẵn trên máy, không tải thêm trình duyệt
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Chạy Worker thật (phục vụ cả giao diện đã build) với D1 tạm, không đụng dữ liệu thật
    command: `npx wrangler dev --local --port ${PORT} --persist-to ../e2e/.state --var JWT_SECRET:e2e-secret-e2e-secret-e2e-secret-123456 --var ALLOW_REGISTRATION:true`,
    cwd: '../cloudflare_worker',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
