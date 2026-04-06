// jest.config.js
//
// NOTE ON CHROME EXTENSION TEST SETUP:
// Testing a Chrome extension with Jest requires more scaffolding than a plain
// Node.js project. The chrome.* APIs — storage, runtime, contextMenus, tabs —
// don't exist in Node. They only exist inside a real Chrome runtime.
//
// The standard solution is:
//   - jest-chrome  : mocks the entire chrome.* namespace for unit tests
//   - testEnvironment: "jsdom" : gives Jest browser globals (document, window, fetch)
//
// NOTE: jest-chrome@0.8.0 only supports Jest 26/27 and is incompatible with
// Jest 29. It has been intentionally excluded from devDependencies until the
// package is updated upstream. Track: https://github.com/nicholasgasior/jest-chrome
//
// This project uses the extraction pattern instead: all testable pure logic
// lives in lib/jobguard-core.js with zero chrome.* dependencies. The current
// test suite runs cleanly in Node without any browser mock.
//
// If/when jest-chrome publishes Jest 29 support, add it back and write
// integration tests for the chrome.storage and chrome.runtime message flows.

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  collectCoverageFrom: ["lib/**/*.js"],
  coverageThreshold: {
    global: {
      lines: 90,
    },
  },
};
