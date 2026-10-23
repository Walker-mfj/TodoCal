import { it, expect, vi } from "vitest";
import { createSessionStore } from "../src/lib/session-storage";

it("clears only the logged-out owner's browser and memory values", () => {
  const store = createSessionStore(() => sessionStorage);
  store.setItem("focus:draft:A:new", "private A");
  store.setItem("focus:command:A:save", "retry A");
  store.setItem("focus:form:B:new", "private B");
  sessionStorage.setItem("unrelated", "keep");
  store.clearOwner("A");
  expect(store.getItem("focus:draft:A:new")).toBeNull();
  expect(sessionStorage.getItem("focus:command:A:save")).toBeNull();
  expect(store.getItem("focus:form:B:new")).toBe("private B");
  expect(sessionStorage.getItem("unrelated")).toBe("keep");
});
it("enumerates memory drafts and suppresses stale browser commands when enumeration and removal throw", () => {
  const store = createSessionStore(() => sessionStorage);
  store.setItem("focus:draft:A:new", "private A");
  sessionStorage.setItem("focus:command:A:unread", "old retry");
  store.setItem("focus:form:B:new", "private B");
  vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  expect(store.keys()).toContain("focus:draft:A:new");
  store.clearOwner("A");
  expect(store.getItem("focus:draft:A:new")).toBeNull();
  expect(store.getItem("focus:command:A:unread")).toBeNull();
  expect(store.getItem("focus:form:B:new")).toBe("private B");
  expect(store.isUnavailable()).toBe(true);
});
it("prefers newer memory values to stale browser data after quota failures", () => {
  const store = createSessionStore(() => sessionStorage);
  store.setItem("focus:draft:A:new", "old");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  store.setItem("focus:draft:A:new", "new");
  expect(store.getItem("focus:draft:A:new")).toBe("new");
});
