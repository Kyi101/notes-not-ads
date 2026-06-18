import assert from "node:assert/strict";
import { assessPageHealth } from "./live-eval-health.mjs";

assert.equal(
  assessPageHealth({
    httpStatus: 200,
    title: "Healthy publisher",
    bodyTextLength: 12000
  }),
  null
);

assert.equal(
  assessPageHealth({
    httpStatus: 200,
    title: "Healthy page with no detected ads",
    bodyTextLength: 900
  }),
  null
);

assert.deepEqual(
  assessPageHealth({
    httpStatus: 503,
    title: "Publisher",
    bodyTextLength: 500
  }),
  {
    code: "http-status",
    message: "Page returned HTTP 503."
  }
);

assert.deepEqual(
  assessPageHealth({
    httpStatus: 200,
    title: "Application error: a client-side exception has occurred",
    bodyTextLength: 132
  }),
  {
    code: "error-title",
    message:
      "Page rendered an error state: Application error: a client-side exception has occurred"
  }
);

assert.deepEqual(
  assessPageHealth({
    httpStatus: 200,
    title: "MSN | Personalized News",
    bodyTextLength: 0
  }),
  {
    code: "empty-body",
    message: "Page rendered no readable body text."
  }
);

console.log("PASS live eval page health");
