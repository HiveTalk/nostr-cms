// Explicit route for POST /api/ai/chat/completions — the [...path] catch-all
// only matches a single segment on this deployment, so multi-segment paths
// need their own file. All logic lives in ../_proxy.ts.
export { default, config } from '../_proxy';
