/**
 * Centralized prompt management
 * All AI prompts used throughout the application
 */

export type PromptKey =
  | "segmentation"
  | "conversation-summary"
  | "component-identification"
  | "component-mapping";

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
The purpose is semantic segmentation in way that's suitable for hierarchical categorization.
Only give me the top level sections to split the text sufficiently.
Return ONLY a valid JSON array of substrings with positive lookahead which I can use to run string split on in javascript.

Example response format: ["(?=<section1>)", "(?=<section2>)"]

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
    template: ({ conversationJson }) => `given this conversation, give me a list of all its components for a summary view
each component can be 3 to 4 words in length
just give me a list in a json array like this example:
["abc_document", "xyz_structure", "foo_context", "task", "sources", "breakdown", "reflection", "files_about_bar", "files_about_baz", "tool_calls_about_quix", "xyz blocks", "pqr list"]


<conversation>${conversationJson}</conversation>`,
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
