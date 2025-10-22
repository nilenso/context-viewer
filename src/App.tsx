import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { parserRegistry } from "./parser";
import "./parsers";
import type { Conversation, Message } from "./schema";
import {
  summarizeConversation,
  type ConversationSummary,
} from "./conversation-summary";
import { addTokenCounts } from "./add-token-counts";
import "./App.css";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}`;

interface ParsedConversation {
  id: string;
  filename: string;
  conversation: Conversation;
  summary: ConversationSummary;
}

interface FailedParse {
  id: string;
  filename: string;
  error: string;
}

interface ParseResult {
  success: ParsedConversation[];
  failed: FailedParse[];
}

async function parseFiles(files: File[]): Promise<ParseResult> {
  const success: ParsedConversation[] = [];
  const failed: FailedParse[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const parsedConversation = parserRegistry.parse(data);
      const conversationWithTokens = addTokenCounts(parsedConversation);
      const summary = summarizeConversation(conversationWithTokens);
      success.push({
        id: generateId(),
        filename: file.name,
        conversation: conversationWithTokens,
        summary,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown parsing error";
      failed.push({
        id: generateId(),
        filename: file.name,
        error: message,
      });
    }
  }

  return { success, failed };
}

function renderMessageContent(message: Message) {
  const parts = message.content;

  if (parts.length === 1) {
    const singlePart = parts[0];
    if (singlePart && singlePart.type === "text") {
      return (
        <div>
          {singlePart.token_count !== undefined && (
            <div className="token-count-inline">
              {singlePart.token_count} tokens
            </div>
          )}
          <p className="message-text">{singlePart.text}</p>
        </div>
      );
    }
  }

  return (
    <div className="message-parts">
      {parts.map((part, index) => {
        switch (part.type) {
          case "text":
            return (
              <div key={index} className="part part-text">
                <div className="part-label">
                  Text
                  {part.token_count !== undefined && (
                    <span className="token-count"> ({part.token_count} tokens)</span>
                  )}
                </div>
                <div>{part.text}</div>
              </div>
            );
          case "file":
            return (
              <div key={index} className="part part-file">
                <div className="part-label">File</div>
                <div>Media type: {part.mediaType}</div>
                <div>Data: {part.data.slice(0, 120)}</div>
              </div>
            );
          case "image":
            return (
              <div key={index} className="part part-image">
                <div className="part-label">Image</div>
                <div>Media type: {part.mediaType ?? "unknown"}</div>
              </div>
            );
          case "reasoning":
            return (
              <div key={index} className="part part-reasoning">
                <div className="part-label">
                  Reasoning
                  {part.token_count !== undefined && (
                    <span className="token-count"> ({part.token_count} tokens)</span>
                  )}
                </div>
                <div>{part.text}</div>
              </div>
            );
          case "tool-call":
            return (
              <div key={index} className="part part-tool">
                <div className="part-label">
                  Tool Call
                  {part.token_count !== undefined && (
                    <span className="token-count"> ({part.token_count} tokens)</span>
                  )}
                </div>
                <div>ID: {part.toolCallId}</div>
                <div>Tool: {part.toolName}</div>
                <pre className="part-code">
                  {JSON.stringify(part.input, null, 2)}
                </pre>
              </div>
            );
          case "tool-result":
            return (
              <div key={index} className="part part-tool">
                <div className="part-label">
                  Tool Result
                  {part.token_count !== undefined && (
                    <span className="token-count"> ({part.token_count} tokens)</span>
                  )}
                </div>
                <div>ID: {part.toolCallId}</div>
                <div>Tool: {part.toolName}</div>
                <pre className="part-code">
                  {JSON.stringify(part.output, null, 2)}
                </pre>
                {part.isError ? <div className="part-error">Error</div> : null}
              </div>
            );
          default:
            return (
              <div key={index} className="part">
                <div className="part-label">Unknown part</div>
              </div>
            );
        }
      })}
    </div>
  );
}

export default function App() {
  const [parsedConversations, setParsedConversations] = useState<
    ParsedConversation[]
  >([]);
  const [failedParses, setFailedParses] = useState<FailedParse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const parseMutation = useMutation({
    mutationFn: parseFiles,
    onSuccess: ({ success, failed }) => {
      setParsedConversations((prev) => [...prev, ...success]);
      setFailedParses((prev) => [...prev, ...failed]);

      if (success.length > 0) {
        const [firstSuccess] = success;
        if (firstSuccess) {
          setSelectedId((prev) => prev ?? firstSuccess.id);
        }
      }
    },
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => parseMutation.mutate(acceptedFiles),
    accept: {
      "text/plain": [".txt"],
      "application/json": [".json"],
    },
    multiple: true,
  });

  const selectedConversation = useMemo(() => {
    if (parsedConversations.length === 0) return undefined;
    return (
      parsedConversations.find((conv) => conv.id === selectedId) ??
      parsedConversations[0]
    );
  }, [parsedConversations, selectedId]);

  useEffect(() => {
    if (parsedConversations.length === 0) {
      setSelectedId(null);
      return;
    }

    const [firstConversation] = parsedConversations;
    if (!firstConversation) {
      setSelectedId(null);
      return;
    }

    if (!selectedId) {
      setSelectedId(firstConversation.id);
      return;
    }

    if (!parsedConversations.some((conv) => conv.id === selectedId)) {
      setSelectedId(firstConversation.id);
    }
  }, [parsedConversations, selectedId]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Context Viewer</h1>
        <p className="app-subtitle">
          Upload one or more conversation logs in JSON or text format. Each file
          will be parsed into the standard conversation structure.
        </p>
      </header>

      <section
        className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
        {...getRootProps()}
      >
        <input {...getInputProps()} />
        <div>
          <strong>Drop files here</strong> or click to select files.
          <div className="dropzone-hint">
            Accepts .json and .txt files. Multiple uploads supported.
          </div>
        </div>
      </section>

      {parseMutation.isPending ? (
        <div className="status-banner">Parsing conversations…</div>
      ) : null}

      {failedParses.length > 0 ? (
        <div className="error-panel">
          <h2>Failed to parse</h2>
          <ul>
            {failedParses.map((failure) => (
              <li key={failure.id}>
                <span className="error-filename">{failure.filename}</span>:{" "}
                {failure.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="content">
        <aside className="sidebar">
          <h2>Uploaded Conversations</h2>
          <ul className="conversation-list">
            {parsedConversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={`conversation-item ${
                    conversation.id === selectedConversation?.id
                      ? "conversation-item-active"
                      : ""
                  }`}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <div className="conversation-name">
                    {conversation.filename}
                  </div>
                  <div className="conversation-meta">
                    {conversation.summary.totalMessages} messages
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="main-panel">
          {selectedConversation ? (
            <div className="conversation-view">
              <div className="conversation-column">
                <h2>Conversation</h2>
                <div className="messages-scroll">
                  {selectedConversation.conversation.messages.map(
                    (message, index) => (
                      <article key={index} className={`message ${message.role}`}>
                        <header className="message-header">
                          <span className="message-role">{message.role}</span>
                          <span className="message-index">
                            #{index + 1}
                          </span>
                        </header>
                        {renderMessageContent(message)}
                      </article>
                    )
                  )}
                </div>
              </div>
              <div className="summary-column">
                <h2>Summary</h2>
                <div className="summary-section">
                  <div className="summary-stat">
                    <span className="summary-label">Total messages</span>
                    <span className="summary-value">
                      {selectedConversation.summary.totalMessages}
                    </span>
                  </div>
                  <div className="summary-group">
                    <h3>Messages by role</h3>
                    <ul>
                      {Object.entries(
                        selectedConversation.summary.messagesByRole
                      ).map(([role, count]) => (
                        <li key={role}>
                          <span className="summary-role">{role}</span>
                          <span>{count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="summary-group">
                    <h3>Content structure</h3>
                    <ul>
                      <li>
                        <span className="summary-role">Text-only</span>
                        <span>
                          {selectedConversation.summary.textOnlyMessageCount}
                        </span>
                      </li>
                      <li>
                        <span className="summary-role">Structured</span>
                        <span>
                          {
                            selectedConversation.summary
                              .structuredContentMessageCount
                          }
                        </span>
                      </li>
                    </ul>
                  </div>
                  {Object.keys(selectedConversation.summary.partCounts).length >
                  0 ? (
                    <div className="summary-group">
                      <h3>Parts by type</h3>
                      <ul>
                        {Object.entries(
                          selectedConversation.summary.partCounts
                        ).map(([type, count]) => (
                          <li key={type}>
                            <span className="summary-role">{type}</span>
                            <span>{count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <h2>No conversations yet</h2>
              <p>Upload files to see their parsed conversations and summaries.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
