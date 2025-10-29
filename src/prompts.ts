/**
 * Centralized prompt management
 * All AI prompts used throughout the application
 */

export type PromptKey =
  | "segmentation"
  | "conversation-summary"
  | "component-identification"
  | "component-mapping"
  | "component-coloring"
  | "context-analysis";

interface PromptTemplate {
  key: PromptKey;
  template: (variables: Record<string, any>) => string;
  description: string;
}

const prompts: Record<PromptKey, PromptTemplate> = {
  segmentation: {
    key: "segmentation",
    description: "Segments large text parts into semantic sections",
    template: ({ text }) => `Given the following text, tell me where all you would apply a break.
The purpose is semantic chunking in way that's suitable for categorization.
Only give me the top level sections to split the text into coherent topical chunks.
Return ONLY a valid JSON array of regexes with positive lookahead which I can use to run string split on in javascript.

Example response format: ["(?=regex-of-section-1)", "(?=regex-of-section2)"]

\`\`\`
${text}
\`\`\`
`,
  },

  "conversation-summary": {
    key: "conversation-summary",
    description: "Generates a high-level summary of the entire conversation",
    template: ({ conversationOverview }) => `Analyze this conversation and provide a concise summary covering:

1. Goal: What is the main objective or task being discussed?
2. Turns: How many meaningful exchanges occurred? What was the flow?
3. Result: What was accomplished or concluded?

Keep it brief and to the point. Use simple markdown text formatting only (headings, paragraphs, lists, bold).
Do not use code blocks, tables, or complex formatting.

Conversation:
${JSON.stringify(conversationOverview, null, 2)}`,
  },

  "component-identification": {
    key: "component-identification",
    description: "Identifies components in a conversation for categorization",
    template: ({ conversationJson, customPrompt }) => {
      const userPrompt = customPrompt || getDefaultComponentIdentificationPrompt();
      const outputFormat = `\n\njust give me a list in a json array like this example:\n["abc_document", "xyz_structure", "foo_context", "task", "sources", "breakdown", "reflection", "files_about_bar", "files_about_baz", "tool_calls_about_quix", "xyz blocks", "pqr list"]`;

      return `${userPrompt}${outputFormat}\n\n<conversation>${conversationJson}</conversation>`;
    },
  },

  "component-mapping": {
    key: "component-mapping",
    description: "Maps message part IDs to identified components",
    template: ({ conversationJson, componentsJson }) => `given this conversation and the list of components, give me a mapping
of message part ids in the conversation, to a component from the list, for all the message parts
just give me a simple json object {id: component}

<conversation>${conversationJson}</conversation>
<components>${componentsJson}</components>`,
  },

  "component-coloring": {
    key: "component-coloring",
    description: "Assigns colors to components based on similarity",
    template: ({ componentsJson }) => `Given this list of components, assign a color to each component.
Similar kinds of components should get the same color to make it easy to visually group them.

Available colors: orange, emerald, purple, blue, slate, indigo, gray

Return ONLY a valid JSON object mapping each component to a color name.
Example format: {"component_name": "orange", "another_component": "blue"}

Components:
${componentsJson}`,
  },

  "context-analysis": {
    key: "context-analysis",
    description: "Analyzes conversation context to find opportunities for improvement",
    template: ({ conversationSummary, componentDataCSV, conversationJson }) => `You are analyzing a conversation to identify opportunities for improving context relevance and efficiency.

## Conversation Summary
${conversationSummary}

## Component Distribution Over Time (CSV)
This shows how different context components grew throughout the conversation:

${componentDataCSV}

## Full Conversation
${conversationJson}
# Long Context Failure Detection Prompt

## Goal
Detect and describe four major ways in which long contexts can fail during multi-turn LLM reasoning:
1. **Context Poisoning** — hallucinated information enters and persists.
2. **Context Distraction** — excessive or irrelevant context overwhelms reasoning.
3. **Context Confusion** — superfluous or ambiguous details distort interpretation.
4. **Context Clash** — different parts of the context contradict each other.

Input includes:
- A sequence of conversation messages with timestamps.
- Message components (system, user, assistant, tool, etc.).
- Token counts per component.

The task is to identify when and how these failure modes appear. The model should use its strengths in linguistic pattern recognition, causality inference, and discourse structure understanding rather than token arithmetic.

---

## Detection Instructions

### 1. Context Poisoning
Identify moments when fabricated or false information enters the context and influences later turns.  
**Look for:**
- Confident but unsupported factual claims.
- Sudden introduction of entities, citations, or assumptions not previously mentioned.
- Repetition or reinforcement of false details in later responses.  

### 2. Context Distraction
Detect when irrelevant or overly long context causes reasoning drift or goal loss.  
**Look for:**
- Shifts to unrelated topics after long or dense messages.
- Over-generalized or diluted replies.
- Drop in task precision following verbose input.  

### 3. Context Confusion
Identify moments when redundant or ambiguous context misguides interpretation.  
**Look for:**
- Mixing instructions or subgoals that should stay separate.
- Responses that merge unrelated fragments.
- Logical misalignment between prompt and answer scope.  

### 4. Context Clash
Detect contradictions between parts of the context that lead to inconsistent or oscillating behavior.  
**Look for:**
- Conflicting facts, directives, or tones.
- Shifts in stance or reasoning across turns.
- Attempts to reconcile incompatible information.  

## Guidance
Focus on qualitative reasoning drift and internal inconsistency.  
Infer failure causes from changes in linguistic framing, reasoning steps, or narrative coherence.  
Do not compute token overlap; use text-based behavioral evidence only.

`,
  },
};

/**
 * Get a prompt by key with variable substitution
 */
export function getPrompt(
  key: PromptKey,
  variables: Record<string, any>
): string {
  const promptTemplate = prompts[key];
  if (!promptTemplate) {
    throw new Error(`Prompt not found: ${key}`);
  }
  return promptTemplate.template(variables);
}

/**
 * Get prompt description
 */
export function getPromptDescription(key: PromptKey): string {
  const promptTemplate = prompts[key];
  if (!promptTemplate) {
    throw new Error(`Prompt not found: ${key}`);
  }
  return promptTemplate.description;
}

/**
 * Get all available prompt keys
 */
export function getAllPromptKeys(): PromptKey[] {
  return Object.keys(prompts) as PromptKey[];
}

/**
 * Get the default (user-editable) component identification prompt
 * This is the part shown in the UI without the output format specification
 */
export function getDefaultComponentIdentificationPrompt(): string {
  return `given this conversation, give me a list of all its components for a summary view
each component can be 3 to 4 words in length`;
}
