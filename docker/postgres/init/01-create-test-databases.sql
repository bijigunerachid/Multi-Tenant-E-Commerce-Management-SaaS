-- Runs once, when the postgres volume is first created.
-- Automated tests use their own databases so they never touch development data:
--   vendora_test  backend integration tests (Jest)
--   vendora_e2e   browser end-to-end tests (Playwright)
CREATE DATABASE vendora_test;
CREATE DATABASE vendora_e2e;
