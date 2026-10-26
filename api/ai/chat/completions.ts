// Explicit route for POST /api/ai/chat/completions — the [...path] catch-all
// only matches a single segment on this deployment, so multi-segment paths
// need their own file. All logic lives in ../[...path].ts (it derives the
// route from req.url), this just re-exports it.
export { default, config } from '../[...path]';
