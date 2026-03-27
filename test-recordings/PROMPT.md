You are writing unit tests for a conversation analysis tool. You have:

1. **The source code** in this repository
2. **A test-writing guide** at `docs/session-recording-test-guide.md` — READ THIS FIRST, it explains everything
3. **Two session recording JSON files** in `test-recordings/`:
   - `compaction-single-passthrough.json` — simple file drop of 2 files processed in parallel
   - `compaction-everything.json` — file drop + segmentation edit + prompt edits + apply-to-all + group creation

Your task: write a comprehensive unit test suite for the core library (everything except `src/ui/`).

## Instructions

1. Read `docs/session-recording-test-guide.md` completely first
2. Read `docs/architecture.md` for project structure
3. Read the two session recording files to understand what functions were called and what they returned
4. Read the source code of each function you need to test
5. Write tests, organized as one test file per module:
   - `src/operations/__tests__/conversation-summary.test.ts`
   - `src/operations/__tests__/static-components.test.ts`
   - `src/operations/__tests__/token-counting.test.ts`
   - `src/parsers/__tests__/file-formats.test.ts`
   - `src/parsers/__tests__/parser-registry.test.ts`
   - `src/parsers/__tests__/file-import.test.ts`
   - `src/stages/__tests__/parse.test.ts`
   - `src/stages/__tests__/segment.test.ts`
   - `src/stages/__tests__/identify-components.test.ts`
   - `src/stages/__tests__/classify-components.test.ts`
   - `src/stages/__tests__/color-components.test.ts`
   - `src/stages/__tests__/summarize.test.ts`
   - `src/stages/__tests__/analyze.test.ts`
   - `src/pipeline/__tests__/pipeline.test.ts`
   - `src/stores/__tests__/conversation-store.test.ts`
6. Run `npx vitest run` after writing each test file to verify it passes
7. Use real sample files from `sample-logs/` for test inputs
8. Mock ONLY `generateText`/`streamText` from `"ai"` and `@/stages/ai/config` — nothing else
9. Use the session recording results as ground truth for assertions

Start by reading the guide, then the recordings, then write tests one module at a time, running them as you go.
