import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
  writable: true,
});
