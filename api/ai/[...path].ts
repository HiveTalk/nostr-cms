// Catch-all route for /api/ai/{status,models,...}. All logic lives in
// _proxy.ts (underscore-prefixed, so it is not routed itself). The handler
// derives the sub-route from req.url.
export { default, config } from './_proxy';
