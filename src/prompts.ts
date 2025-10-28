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
    template: ({ conversationSummary, componentDataCSV }) => `You are analyzing a conversation to identify opportunities for improving context relevance and efficiency.

## Conversation Summary
${conversationSummary}

## Component Distribution Over Time (CSV)
This shows how different context components grew throughout the conversation:

${componentDataCSV}

## Your Task
Analyze this data and provide insights in markdown format covering:

1. **Context Growth Patterns**: What patterns do you see in how context accumulated? Which components dominated?

2. **Redundancy & Efficiency**: Are there signs of redundant context? Which components could potentially be reduced or optimized?

3. **Context Relevance**: Based on the conversation goal, which components seem most/least relevant? Are there disproportionate allocations?

4. **Recommendations**: Specific, actionable suggestions for improving context management in similar conversations. Focus on:
   - Components to reduce or eliminate
   - Better segmentation strategies
   - Context retrieval improvements
   - Memory optimization opportunities

Keep your analysis practical and focused on improving context relevance. Use clear headings, bullet points, and be specific about which components you're referring to.`,
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
