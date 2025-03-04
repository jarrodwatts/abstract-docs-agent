import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateText, embed, embedMany, cosineSimilarity } from "ai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load environment variables
dotenv.config();

export type CodeChange = {
  filename: string;
  patch?: string;
  additions: number;
  deletions: number;
};

type DocumentChunk = {
  content: string;
  embedding: number[];
  metadata: {
    source: string;
    type: string;
  };
};

/**
 * AI service for generating content using the Vercel AI SDK
 */
export class AIService {
  public model = openai("gpt-4o-mini");
  private knowledgeBase: DocumentChunk[] = [];
  private readonly MAX_CHUNK_SIZE = 8000; // Characters, not tokens, adjust based on embedding model limits

  /**
   * Chunks text into smaller pieces for embedding if needed
   */
  private chunkText(
    text: string,
    maxChunkSize: number = this.MAX_CHUNK_SIZE
  ): string[] {
    console.log(`🔪 Chunking text of length ${text.length} characters...`);

    // If text is within limits, return as is
    if (text.length <= maxChunkSize) {
      console.log(
        `✅ Text is within size limit (${text.length} characters), keeping as single chunk`
      );
      return [text];
    }

    // Otherwise, split by common code separators
    const chunks: string[] = [];

    // Try to split by function/class definitions first
    const functionRegex =
      /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+)?(async\s+)?(function|class|const|let|var)[\s\S]*?(?={)/g;
    const matches = Array.from(text.matchAll(functionRegex));
    console.log(
      `🔍 Found ${matches.length} potential function/class boundaries for chunking`
    );

    if (matches.length > 1) {
      let lastIndex = 0;
      for (const match of matches) {
        const startIndex = match.index || 0;
        // Get everything from last position to this match
        if (startIndex > lastIndex) {
          const section = text.substring(lastIndex, startIndex).trim();
          if (section.length > 0) {
            if (section.length > maxChunkSize) {
              // Further chunk by line for very large sections
              console.log(
                `⚠️ Section too large (${section.length} characters), chunking by line`
              );
              chunks.push(...this.chunkByLine(section, maxChunkSize));
            } else {
              chunks.push(section);
            }
          }
        }
        lastIndex = startIndex;
      }

      // Get the remainder after the last match
      if (lastIndex < text.length) {
        const section = text.substring(lastIndex).trim();
        if (section.length > 0) {
          if (section.length > maxChunkSize) {
            console.log(
              `⚠️ Remaining section too large (${section.length} characters), chunking by line`
            );
            chunks.push(...this.chunkByLine(section, maxChunkSize));
          } else {
            chunks.push(section);
          }
        }
      }

      console.log(
        `📦 Created ${chunks.length} chunks using function boundaries`
      );
      return chunks;
    }

    // If function splitting didn't work well, try by lines
    console.log(
      `📝 Function boundary chunking didn't work well, falling back to line-by-line chunking`
    );
    return this.chunkByLine(text, maxChunkSize);
  }

  /**
   * Chunk text by line when more granular chunking is needed
   */
  private chunkByLine(text: string, maxChunkSize: number): string[] {
    console.log(`📏 Chunking by line, text length: ${text.length} characters`);
    const lines = text.split(/\r?\n/);
    console.log(`📊 Text has ${lines.length} lines`);

    const chunks: string[] = [];
    let currentChunk = "";

    for (const line of lines) {
      if (
        (currentChunk + line).length > maxChunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push(currentChunk.trim());
        console.log(
          `📦 Created chunk of length ${currentChunk.trim().length} characters`
        );
        currentChunk = "";
      }
      currentChunk += line + "\n";
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      console.log(
        `📦 Created final chunk of length ${
          currentChunk.trim().length
        } characters`
      );
    }

    console.log(`✅ Line chunking complete, created ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * Process an entire repository at once, chunking by file
   */
  public async processRepository(repoPath: string): Promise<void> {
    console.log(`🚀 Starting repository processing at ${repoPath}...`);
    const startTime = Date.now();

    const stats = {
      files: 0,
      chunks: 0,
      errors: 0,
      byType: {} as Record<string, number>,
      largeFiles: 0,
      totalSize: 0,
    };

    const processDirectory = async (
      dirPath: string,
      relativeDir: string = ""
    ): Promise<void> => {
      console.log(`📂 Scanning directory: ${relativeDir || "root"}`);
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      console.log(
        `📋 Found ${entries.length} entries in ${relativeDir || "root"}`
      );

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.join(relativeDir, entry.name);

        // Skip node_modules, .git, and other common directories to ignore
        if (entry.isDirectory()) {
          if (
            ["node_modules", ".git", "dist", "build", ".next"].includes(
              entry.name
            )
          ) {
            console.log(`⏭️ Skipping directory: ${relativePath}`);
            continue;
          }
          await processDirectory(fullPath, relativePath);
        } else {
          // Process files with relevant extensions
          const ext = path.extname(entry.name).toLowerCase();

          // Skip ABI files in the specified directory
          if (relativePath.includes("packages/agw-client/src/abis/")) {
            console.log(`⏭️ Skipping ABI file: ${relativePath}`);
            continue;
          }

          // Skip test files in the test directory
          if (relativePath.includes("packages/agw-client/test/")) {
            console.log(`⏭️ Skipping test file: ${relativePath}`);
            continue;
          }

          // Skip files in the web3-react-agw directory
          if (relativePath.includes("packages/web3-react-agw/")) {
            console.log(`⏭️ Skipping web3-react-agw file: ${relativePath}`);
            continue;
          }

          if ([".ts", ".tsx", ".js", ".jsx", ".md", ".json"].includes(ext)) {
            try {
              console.log(`📄 Processing file: ${relativePath}`);
              const content = fs.readFileSync(fullPath, "utf-8");
              const fileSize = content.length;
              stats.totalSize += fileSize;

              const fileType = this.determineFileType(ext);
              stats.byType[fileType] = (stats.byType[fileType] || 0) + 1;

              console.log(
                `📊 File stats: ${relativePath}, size: ${fileSize} characters, type: ${fileType}`
              );

              if (content.length > this.MAX_CHUNK_SIZE) {
                // File is too large, chunk it
                console.log(
                  `⚠️ Large file detected: ${relativePath} (${fileSize} characters)`
                );
                stats.largeFiles++;

                const chunks = this.chunkText(content);
                console.log(
                  `🔢 Split ${relativePath} into ${chunks.length} chunks`
                );

                for (let i = 0; i < chunks.length; i++) {
                  console.log(
                    `📦 Processing chunk ${i + 1}/${
                      chunks.length
                    } of ${relativePath}, size: ${chunks[i].length} characters`
                  );
                  await this.addToKnowledgeBase(chunks[i], {
                    source: `${relativePath} (part ${i + 1}/${chunks.length})`,
                    type: fileType,
                  });
                  stats.chunks++;
                }
              } else {
                // File fits within size limit, add as is
                console.log(`✅ File within size limit: ${relativePath}`);
                await this.addToKnowledgeBase(content, {
                  source: relativePath,
                  type: fileType,
                });
                stats.chunks++;
              }
              stats.files++;

              if (stats.files % 10 === 0) {
                const elapsedSeconds = Math.round(
                  (Date.now() - startTime) / 1000
                );
                console.log(
                  `🔄 Progress update: Processed ${stats.files} files (${stats.chunks} chunks) in ${elapsedSeconds} seconds`
                );
                console.log(
                  `📊 Average chunks per file: ${(
                    stats.chunks / stats.files
                  ).toFixed(2)}`
                );
              }
            } catch (error) {
              console.error(`❌ Error processing file ${fullPath}:`, error);
              stats.errors++;
            }
          } else {
            console.log(
              `⏭️ Skipping file with unsupported extension: ${relativePath}`
            );
          }
        }
      }
    };

    await processDirectory(repoPath);

    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `🎉 Repository processing complete in ${elapsedSeconds} seconds!`
    );
    console.log(`📊 Stats summary:`);
    console.log(`  • Total files processed: ${stats.files}`);
    console.log(`  • Total chunks created: ${stats.chunks}`);
    console.log(`  • Files requiring chunking: ${stats.largeFiles}`);
    console.log(
      `  • Average chunks per file: ${(stats.chunks / stats.files).toFixed(2)}`
    );
    console.log(
      `  • Total size processed: ${(stats.totalSize / 1024 / 1024).toFixed(
        2
      )} MB`
    );
    console.log(`  • Files by type: ${JSON.stringify(stats.byType)}`);
    console.log(`  • Errors encountered: ${stats.errors}`);
    console.log(
      `  • Current knowledge base size: ${this.knowledgeBase.length} chunks`
    );
  }

  /**
   * Determine the type of file based on its extension
   */
  private determineFileType(extension: string): string {
    switch (extension) {
      case ".ts":
      case ".tsx":
      case ".js":
      case ".jsx":
        return "code";
      case ".md":
        return "documentation";
      case ".json":
        return "configuration";
      default:
        return "other";
    }
  }

  /**
   * Add a document to the knowledge base
   */
  public async addToKnowledgeBase(
    content: string,
    metadata: { source: string; type: string }
  ) {
    console.log(
      `🧠 Adding to knowledge base: ${metadata.source} (${content.length} characters)`
    );
    console.log(`🔍 Content preview: ${content.substring(0, 100)}...`);

    console.log(`🔢 Generating embedding for: ${metadata.source}`);
    const embedStartTime = Date.now();
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: content,
    });
    const embedTime = Date.now() - embedStartTime;
    console.log(
      `✅ Embedding generated in ${embedTime}ms, vector dimensions: ${embedding.length}`
    );

    this.knowledgeBase.push({
      content,
      embedding,
      metadata,
    });
    console.log(
      `📚 Knowledge base now has ${this.knowledgeBase.length} entries`
    );
  }

  /**
   * === JOE AGENT ===
   * Generate a code summary given a list of code changes
   */
  public async generateCodeSummary(
    codeChanges: CodeChange[],
    relevantContexts?: string[]
  ) {
    console.log(`🔍 Analyzing ${codeChanges.length} code changes`);

    const systemPrompt = `You are JOE, an AI agent trained on the Abstract Global Wallet SDK codebase. Your role is to analyze commits to the agw-sdk main branch and identify ONLY changes that affect downstream consumers of the SDK.

CRITICAL: Focus EXCLUSIVELY on PUBLIC API changes that developers using the SDK would need to know about.

PAY SPECIAL ATTENTION TO:
- Interface definitions (especially parameter changes like required → optional)
- Provider components and their props
- React hooks and their signatures
- Public client methods and their parameters
- Config object properties and their types
- Any change to exported types, constants, or functions

INCLUDE ONLY:
- Changes to exported functions, classes, interfaces, or types that developers directly interact with
- Modified function signatures, parameters, or return types in the public API
- New public features or capabilities
- Deprecated or removed public APIs
- Breaking changes that would require developers to update their code

DO NOT INCLUDE:
- Internal implementation details that don't change how the SDK is used
- Bug fixes that don't affect the public API interface
- Test files or changes to tests
- Changes that don't alter the developer experience

For each relevant PUBLIC API change, analyze:
1. What exactly changed in the public interface
2. How this affects developers who use the SDK
3. Whether it's a breaking change requiring developer action

If no public API changes were detected, explicitly state that "No changes were found that would affect downstream developers using the SDK."

Remember: Developers only care about what affects THEIR code, not internal SDK improvements.`;

    const { text } = await generateText({
      model: this.model,
      prompt: `
      ## CODE CHANGES:
      ${codeChanges
        .map(
          (change) =>
            `### ${change.filename}
         +${change.additions} -${change.deletions}
         
         \`\`\`diff
         ${change.patch || "No patch available"}
         \`\`\`
        `
        )
        .join("\n\n")}
      `,
      system: `
      ## CORE INSTRUCTIONS:

      ${systemPrompt}

      ## RELEVANT CONTEXT from the knowledge base:
      ${relevantContexts?.join("\n")}
      `,
    });

    return text;
  }

  /**
   * Retrieve relevant context based on a query
   */
  public async getRelevantContext(
    query: string,
    maxResults: number = 5
  ): Promise<string> {
    // Minimal logging - just the action
    console.log(`🔍 Finding context`);

    if (this.knowledgeBase.length === 0) {
      return "No knowledge base available";
    }

    // Filter knowledge base to only include code files
    const codeEntries = this.knowledgeBase.filter((doc) => {
      const source = doc.metadata.source;
      const filename = source.split(" ")[0];
      const ext = path.extname(filename).toLowerCase();
      return [".ts", ".tsx", ".js", ".jsx"].includes(ext);
    });

    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: query,
    });

    const results = codeEntries
      .map((doc) => ({
        document: doc,
        similarity: cosineSimilarity(embedding, doc.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);

    return results
      .map((r) => `[${r.document.metadata.source}] ${r.document.content}`)
      .join("\n\n");
  }

  /**
   * Export the knowledge base to a file for persistence
   */
  public saveKnowledgeBase(filePath: string): void {
    console.log(`💾 Saving knowledge base to ${filePath}...`);

    if (this.knowledgeBase.length === 0) {
      console.log(`⚠️ Knowledge base is empty, nothing to save!`);
      return;
    }

    const startTime = Date.now();
    const data = JSON.stringify(this.knowledgeBase, null, 2);
    const fileSizeMB = (data.length / 1024 / 1024).toFixed(2);

    fs.writeFileSync(filePath, data);

    const saveTime = Date.now() - startTime;
    console.log(`✅ Knowledge base saved in ${saveTime}ms`);
    console.log(`📊 Save stats:`);
    console.log(`  • Entries saved: ${this.knowledgeBase.length}`);
    console.log(`  • File size: ${fileSizeMB} MB`);
    console.log(`  • File path: ${filePath}`);
  }

  /**
   * Import a previously saved knowledge base
   */
  public loadKnowledgeBase(filePath: string): void {
    console.log(`📂 Loading knowledge base from ${filePath}...`);

    if (fs.existsSync(filePath)) {
      const startTime = Date.now();

      const data = fs.readFileSync(filePath, "utf-8");
      const fileSizeMB = (data.length / 1024 / 1024).toFixed(2);
      console.log(`📊 File size: ${fileSizeMB} MB`);

      this.knowledgeBase = JSON.parse(data);

      const loadTime = Date.now() - startTime;
      console.log(`✅ Knowledge base loaded in ${loadTime}ms`);
      console.log(`📊 Load stats:`);
      console.log(`  • Entries loaded: ${this.knowledgeBase.length}`);

      // Sample content types
      const types = {} as Record<string, number>;
      this.knowledgeBase.forEach((entry) => {
        types[entry.metadata.type] = (types[entry.metadata.type] || 0) + 1;
      });
      console.log(`  • Content types: ${JSON.stringify(types)}`);
    } else {
      console.error(`❌ Knowledge base file not found at ${filePath}`);
    }
  }

  /**
   * === Joe Agent ===
   * An agent who is an expert at summarising code changes.
   * He provides a contextual overview of what the code changes are.
   * Given a list of code changes, he will provide a summary of the changes.
   * He particularly focuses on the impact of the changes on the codebase
   * and what affects it has on developers who are downstream of the code changes.
   */
  public async summarizeCodeChanges(codeChanges: CodeChange[]) {
    console.log(`🤖 Joe Agent analyzing ${codeChanges.length} code changes...`);

    console.log(`🔍 Retrieving relevant context for code changes...`);
    const context = await this.getRelevantContext(
      "code changes and their impact"
    );
    console.log(`✅ Retrieved ${context.split("\n").length} lines of context`);

    console.log(`📝 Generating summary prompt...`);
    const prompt = `You are an expert at understanding code changes and their impact.
    Using the following context about similar changes:
    ${context}
    
    Please analyze these code changes:
    ${codeChanges
      .map(
        (change) => `
    File: ${change.filename}
    Patch: ${change.patch || "No patch available"}
    +${change.additions} -${change.deletions}
    `
      )
      .join("\n")}
    
    Provide a summary focusing on:
    1. What changed in the code
    2. Impact on the codebase
    3. Effects on downstream developers`;

    console.log(`🧠 Generating summary text...`);
    const startTime = Date.now();
    const { text } = await generateText({
      model: this.model,
      prompt,
    });
    const generateTime = Date.now() - startTime;
    console.log(`✅ Summary generated in ${generateTime}ms`);
    console.log(`📊 Summary length: ${text.length} characters`);

    return text;
  }

  /**
   * Generate documentation updates based on code changes
   */
  public async generateDocumentationUpdates(
    codeChanges: CodeChange[],
    commitMessages: string[],
    existingDocs: Array<{ path: string; content: string }>
  ) {
    console.log(
      `📚 Generating documentation updates for ${codeChanges.length} code changes...`
    );
    console.log(`📄 Updating ${existingDocs.length} documentation files`);

    console.log(`🔍 Retrieving relevant context for documentation updates...`);
    const context = await this.getRelevantContext(
      "documentation updates for code changes" // TODO - retarded
    );
    console.log(`✅ Retrieved ${context.split("\n").length} lines of context`);

    console.log(`📝 Generating documentation update prompt...`);
    const prompt = `You are an expert technical writer.
    Using the following context about similar documentation updates:
    ${context}
    
    Please analyze these code changes and existing documentation:
    
    Code Changes:
    ${codeChanges
      .map(
        (change) => `
    File: ${change.filename}
    Patch: ${change.patch || "No patch available"}
    +${change.additions} -${change.deletions}
    `
      )
      .join("\n")}
    
    Commit Messages:
    ${commitMessages.join("\n")}
    
    Existing Documentation:
    ${existingDocs
      .map(
        (doc) => `
    Path: ${doc.path}
    Content: ${doc.content}
    `
      )
      .join("\n")}
    
    Generate updated documentation that:
    1. Accurately reflects the code changes
    2. Maintains consistent style with existing docs
    3. Includes practical examples where helpful`;

    console.log(`🧠 Generating documentation text...`);
    const startTime = Date.now();
    const { text } = await generateText({
      model: this.model,
      prompt,
    });
    const generateTime = Date.now() - startTime;
    console.log(`✅ Documentation generated in ${generateTime}ms`);
    console.log(`📊 Documentation length: ${text.length} characters`);

    const updates = existingDocs.map((doc) => ({
      path: doc.path,
      content: text,
      summary: `Updated documentation for ${doc.path}`,
    }));

    console.log(`📊 Created ${updates.length} document updates`);
    return updates;
  }

  /**
   * Generate pull request content for documentation updates
   */
  public async generatePullRequestContent(
    updates: Array<{ path: string; summary: string }>
  ) {
    console.log(
      `🔄 Generating PR content for ${updates.length} documentation updates...`
    );

    console.log(`🔍 Retrieving relevant context for PR content...`);
    const context = await this.getRelevantContext(
      "pull request for documentation updates"
    );
    console.log(`✅ Retrieved ${context.split("\n").length} lines of context`);

    console.log(`📝 Generating PR content prompt...`);
    const prompt = `You are an expert at writing clear pull request descriptions.
    Using the following context about similar PRs:
    ${context}
    
    Please create a pull request title and body for these documentation updates:
    ${updates
      .map(
        (update) => `
    Path: ${update.path}
    Summary: ${update.summary}
    `
      )
      .join("\n")}
    
    Focus on:
    1. Clear description of changes
    2. Impact on documentation
    3. Any special notes for reviewers`;

    console.log(`🧠 Generating PR content...`);
    const startTime = Date.now();
    const { text } = await generateText({
      model: this.model,
      prompt,
    });
    const generateTime = Date.now() - startTime;
    console.log(`✅ PR content generated in ${generateTime}ms`);

    const [title, ...bodyLines] = text.split("\n");
    const prContent = {
      title: title.replace("Title: ", "").trim(),
      body: bodyLines.join("\n").trim(),
    };

    console.log(`📊 PR Content:`);
    console.log(`  • Title: ${prContent.title}`);
    console.log(`  • Body preview: ${prContent.body.substring(0, 100)}...`);

    return prContent;
  }
}
