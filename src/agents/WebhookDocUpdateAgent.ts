import { BaseAgent } from "../core/BaseAgent.js";
import { GitHubSource } from "../sources/GitHubSource.js";
import { GitHubPROutput } from "../outputs/GitHubPROutput.js";
import { AIService, CodeChange } from "../utils/ai.js";
import { AgentEventType } from "../core/types.js";
import { Webhooks } from "@octokit/webhooks";
import { createNodeMiddleware } from "@octokit/webhooks";
import { generateText } from "ai";
import path from "path";
import fs from "fs";

/**
 * Agent that responds to GitHub webhooks and proposes documentation updates
 */
export class WebhookDocUpdateAgent extends BaseAgent {
  private aiService: AIService;
  public webhooks: Webhooks;
  private monitorRepoOwner: string = "";
  private monitorRepoName: string = "";
  private docsRepoOwner: string = "";
  private docsRepoName: string = "";
  private githubToken: string = "";
  private docsContent: Array<{
    type: string;
    name: string;
    path: string;
    content?: string;
    sha: string;
  }> = [];
  private knowledgeBasePath: string = "";
  private repoPath: string = "";

  constructor(
    id: string = "webhook-doc-update-agent",
    name: string = "Webhook Documentation Update Agent",
    description: string = "Responds to GitHub webhooks and proposes documentation updates"
  ) {
    super(id, name, description);
    this.aiService = new AIService();
    this.webhooks = new Webhooks({
      secret: process.env.GITHUB_WEBHOOK_SECRET || "",
    });
  }

  /**
   * Initialize the agent with configuration and set up webhook handlers
   */
  async onInitialize(): Promise<void> {
    console.log(`🔧 Initializing ${this.name}...`);

    // Get configuration from environment variables or provided config
    this.monitorRepoOwner =
      this.config.monitorRepoOwner || process.env.MONITOR_REPO_OWNER || "";
    this.monitorRepoName =
      this.config.monitorRepoName || process.env.MONITOR_REPO_NAME || "";
    this.docsRepoOwner =
      this.config.docsRepoOwner || process.env.DOCS_REPO_OWNER || "";
    this.docsRepoName =
      this.config.docsRepoName || process.env.DOCS_REPO_NAME || "";
    this.githubToken =
      this.config.githubToken || process.env.GITHUB_TOKEN || "";

    // Set paths for knowledge base and repositories
    this.knowledgeBasePath =
      this.config.knowledgeBasePath ||
      process.env.KNOWLEDGE_BASE_PATH ||
      path.join(
        process.cwd(),
        "data",
        `${this.monitorRepoName}-knowledge.json`
      );

    // Check for repository in multiple potential locations
    const potentialRepoPaths = [
      this.config.repoPath,
      process.env.REPO_PATH,
      path.join(process.cwd(), "test-repo", this.monitorRepoName),
      path.join(process.cwd(), "repos", this.monitorRepoName),
    ].filter(Boolean); // Filter out undefined/null values

    // Find the first path that exists
    this.repoPath =
      potentialRepoPaths.find((p) => p && fs.existsSync(p)) ||
      path.join(process.cwd(), "test-repo", this.monitorRepoName); // Default to test-repo path

    if (!this.monitorRepoOwner || !this.monitorRepoName) {
      throw new Error("Monitor repository owner and name are required");
    }

    if (!this.docsRepoOwner || !this.docsRepoName) {
      throw new Error("Documentation repository owner and name are required");
    }

    if (!this.githubToken) {
      throw new Error("GitHub token is required");
    }

    // Set up the GitHub source for monitoring code changes
    const githubSource = new GitHubSource(
      "github-code-source",
      "GitHub Code Source",
      `Monitors changes to ${this.monitorRepoOwner}/${this.monitorRepoName}`
    );

    // Set up the GitHub output for creating documentation PRs
    const githubOutput = new GitHubPROutput(
      "github-docs-pr-output",
      "GitHub Docs PR Output",
      `Creates PRs for documentation updates in ${this.docsRepoOwner}/${this.docsRepoName}`
    );

    // Initialize the source and output
    await githubSource.initialize({
      owner: this.monitorRepoOwner,
      repo: this.monitorRepoName,
      token: this.githubToken,
    });

    await githubOutput.initialize({
      owner: this.docsRepoOwner,
      repo: this.docsRepoName,
      token: this.githubToken,
      defaultBaseBranch: "main",
    });

    // Add the source and output to the agent
    this.addSource(githubSource);
    this.addOutput(githubOutput);

    // Set up webhook handlers
    this.setupWebhookHandlers();

    // Initialize docs content
    this.docsContent = await githubSource.getDocsContent(
      this.docsRepoOwner,
      this.docsRepoName
    );

    console.log(`📚 Loaded ${this.docsContent.length} documentation files`);

    // Initialize knowledge base
    await this.initializeKnowledgeBase();

    // Log initialization
    console.log(
      `✅ Initialized ${this.name} to monitor ${this.monitorRepoOwner}/${this.monitorRepoName} and update docs in ${this.docsRepoOwner}/${this.docsRepoName}`
    );
  }

  /**
   * Initialize the knowledge base from either saved file or by processing the repository
   */
  private async initializeKnowledgeBase(): Promise<void> {
    console.log(`🧠 Initializing knowledge base...`);

    // Check if knowledge base file exists
    if (fs.existsSync(this.knowledgeBasePath)) {
      console.log(
        `📂 Found existing knowledge base at ${this.knowledgeBasePath}`
      );
      try {
        this.aiService.loadKnowledgeBase(this.knowledgeBasePath);
        console.log(`✅ Successfully loaded knowledge base`);
        return;
      } catch (error) {
        console.error(`⚠️ Error loading knowledge base: ${error}`);
        console.log(`🔄 Will regenerate knowledge base...`);
      }
    }

    // Process repository if needed
    if (fs.existsSync(this.repoPath)) {
      console.log(`📂 Found repository at ${this.repoPath}`);
      console.log(`🔄 Processing repository to build knowledge base...`);

      try {
        await this.aiService.processRepository(this.repoPath);

        // Ensure the data directory exists
        const dataDir = path.dirname(this.knowledgeBasePath);
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }

        // Save the knowledge base
        this.aiService.saveKnowledgeBase(this.knowledgeBasePath);
        console.log(`✅ Successfully built and saved knowledge base`);
      } catch (error) {
        console.error(`❌ Error processing repository: ${error}`);
      }
    } else {
      console.warn(`⚠️ Repository path not found at ${this.repoPath}`);

      // Try to provide helpful debugging info
      if (process.cwd() === "/home/jarrod/abstract-agents") {
        console.log(`🔍 Checking alternative repository locations...`);
        const testRepoPath = path.join(
          process.cwd(),
          "test-repo",
          this.monitorRepoName
        );
        const reposPath = path.join(
          process.cwd(),
          "repos",
          this.monitorRepoName
        );

        if (fs.existsSync(testRepoPath)) {
          console.log(`💡 Found repository at ${testRepoPath}`);
          console.log(`💡 Consider using this path in your configuration`);
        } else if (fs.existsSync(reposPath)) {
          console.log(`💡 Found repository at ${reposPath}`);
          console.log(`💡 Consider using this path in your configuration`);
        } else {
          console.log(`🔍 Listing directories in ${process.cwd()}:`);
          try {
            const dirs = fs
              .readdirSync(process.cwd(), { withFileTypes: true })
              .filter((dirent) => dirent.isDirectory())
              .map((dirent) => dirent.name);
            console.log(dirs.join(", "));
          } catch (e) {
            console.error(`❌ Error listing directories: ${e}`);
          }
        }
      }

      console.warn(
        `⚠️ Knowledge base will be empty until repository is cloned or manually processed`
      );
    }
  }

  /**
   * Update the knowledge base with new files or changes
   */
  private async updateKnowledgeBase(changedFiles: string[]): Promise<void> {
    console.log(
      `🔄 Updating knowledge base with ${changedFiles.length} changed files...`
    );

    if (!fs.existsSync(this.repoPath)) {
      console.warn(`⚠️ Repository path not found at ${this.repoPath}`);
      return;
    }

    let updated = false;

    // Process only the changed files
    for (const filePath of changedFiles) {
      // Skip ABI files in the specified directory
      if (filePath.includes("packages/agw-client/src/abis/")) {
        console.log(`⏭️ Skipping ABI file: ${filePath}`);
        continue;
      }

      // Skip test files in the test directory
      if (filePath.includes("packages/agw-client/test/")) {
        console.log(`⏭️ Skipping test file: ${filePath}`);
        continue;
      }

      // Skip files in the web3-react-agw directory
      if (filePath.includes("packages/web3-react-agw/")) {
        console.log(`⏭️ Skipping web3-react-agw file: ${filePath}`);
        continue;
      }

      const fullPath = path.join(this.repoPath, filePath);

      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const ext = path.extname(filePath).toLowerCase();

          if ([".ts", ".tsx", ".js", ".jsx", ".md", ".json"].includes(ext)) {
            const fileType = this.aiService["determineFileType"](ext);

            console.log(`📄 Processing changed file: ${filePath}`);

            // If the file is large, follow the same chunking logic as in processRepository
            if (content.length > this.aiService["MAX_CHUNK_SIZE"]) {
              const chunks = this.aiService["chunkText"](content);
              console.log(`🔢 Split ${filePath} into ${chunks.length} chunks`);

              for (let i = 0; i < chunks.length; i++) {
                await this.aiService.addToKnowledgeBase(chunks[i], {
                  source: `${filePath} (part ${i + 1}/${chunks.length})`,
                  type: fileType,
                });
              }
            } else {
              await this.aiService.addToKnowledgeBase(content, {
                source: filePath,
                type: fileType,
              });
            }

            updated = true;
          }
        } catch (error) {
          console.error(`❌ Error processing changed file ${filePath}:`, error);
        }
      }
    }

    // Save the updated knowledge base if changes were made
    if (updated) {
      this.aiService.saveKnowledgeBase(this.knowledgeBasePath);
      console.log(`✅ Knowledge base updated and saved`);
    }
  }

  /**
   * Set up webhook handlers for GitHub events
   */
  private setupWebhookHandlers(): void {
    // Handle push events
    this.webhooks.on("push", async ({ payload }) => {
      try {
        // Check if the push is to the monitored repository
        if (
          payload.repository.owner &&
          (payload.repository.owner.name === this.monitorRepoOwner ||
            payload.repository.owner.login === this.monitorRepoOwner)
        ) {
          console.log(
            `📥 Processing push event for ${payload.repository.full_name}`
          );

          // Reset the last checked SHA in the GitHub source to ensure we get the latest commits
          console.log("🔄 Resetting last checked SHA");
          const githubSource = this.sources[0] as GitHubSource;
          githubSource.resetLastChecked();

          // Extract changed files from the push event
          const changedFiles = payload.commits.flatMap((commit: any) => [
            ...(commit.added || []),
            ...(commit.modified || []),
            ...(commit.removed || []),
          ]);

          // Update knowledge base with changed files
          if (changedFiles.length > 0) {
            console.log(`📋 Detected ${changedFiles.length} changed files`);
            await this.updateKnowledgeBase(changedFiles);
          }

          // Process the changes
          console.log("🚀 Starting documentation update process");
          await this.process().catch((error) => {
            console.error("❌ Error in process() method:", error);
            throw error;
          });
          console.log("✅ Finished documentation update process");
        } else {
          console.log("⚠️ Repository mismatch. Skipping processing.");
          console.log(
            "Full owner object:",
            JSON.stringify(payload.repository.owner, null, 2)
          );
          console.log(
            `Got owner: ${
              payload.repository.owner?.name || payload.repository.owner?.login
            }`
          );
          console.log(`Expected: ${this.monitorRepoOwner}`);
        }
      } catch (error) {
        console.error("❌ Error in push event handler:", error);
        throw error; // Re-throw to be caught by the webhook error handler
      }
    });

    // Handle pull request events (optional, for future expansion)
    this.webhooks.on("pull_request.closed", async ({ payload }) => {
      // Only process merged PRs
      if (
        payload.pull_request.merged &&
        payload.repository.owner.login === this.monitorRepoOwner &&
        payload.repository.name === this.monitorRepoName
      ) {
        console.log(`📥 Processing merged PR #${payload.pull_request.number}`);

        // Reset the last checked SHA in the GitHub source
        const githubSource = this.sources[0] as GitHubSource;
        githubSource.resetLastChecked();

        // Get list of files changed in the PR
        const changedFiles = Array.isArray(payload.pull_request.changed_files)
          ? payload.pull_request.changed_files.map((file: any) => file.filename)
          : [];

        // Update knowledge base with changed files
        if (changedFiles.length > 0) {
          await this.updateKnowledgeBase(changedFiles);
        }

        // Process the changes
        await this.process();
      }
    });

    // Add an error handler for the webhooks instance
    this.webhooks.onError((error) => {
      console.error("❌ Webhook error occurred:", error);
    });

    // Add a before hook to log incoming webhooks
    this.webhooks.onAny(async ({ id, name, payload }) => {
      console.log(`📣 Received webhook ${name} with id ${id}`);
    });
  }

  /**
   * Process data from sources and generate documentation updates
   */
  async process(): Promise<void> {
    try {
      const githubSource = this.sources[0] as GitHubSource;
      if (!githubSource) throw new Error("GitHub source not found");
      const githubOutput = this.outputs[0] as GitHubPROutput;
      if (!githubOutput) throw new Error("GitHub output not found");

      // Get latest commit
      const commit = await githubSource.getData();
      if (!commit) {
        console.log("📭 No new commit found");
        return;
      }

      // Extract code changes from commit
      const codeChanges: CodeChange[] = (commit.files || []).map((file) => ({
        filename: file.filename,
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
      }));

      // Filter to include only code files, excluding tests and internals
      const codeFileChanges = codeChanges.filter((change) => {
        const ext = path.extname(change.filename).toLowerCase();
        const isCodeFile = [".ts", ".tsx", ".js", ".jsx"].includes(ext);
        const isTestFile =
          change.filename.includes("/test/") ||
          change.filename.includes(".test.") ||
          change.filename.includes(".spec.");
        const isProbablyPublicAPI =
          change.filename.includes("Provider") ||
          change.filename.includes("provider") ||
          change.filename.includes("interface") ||
          change.filename.includes("public") ||
          change.filename.includes("exports") ||
          change.filename.includes("/src/") ||
          !change.filename.includes("internal");

        return isCodeFile && !isTestFile && isProbablyPublicAPI;
      });

      if (codeFileChanges.length === 0) {
        console.log("📭 No relevant SDK code changes");
        return;
      }

      console.log(`📋 Analyzing ${codeFileChanges.length} SDK files`);

      // Get context and generate summary
      const relevantContext = await this.aiService.getRelevantContext(
        `Code context for changes in ${codeFileChanges
          .map((c) => c.filename)
          .join(", ")}`
      );

      const codeSummary = await this.aiService.generateCodeSummary(
        codeFileChanges,
        [relevantContext]
      );

      console.log(`==============================
GENERATED CODE SUMMARY:

${codeSummary}
==============================`);
    } catch (error) {
      console.error("❌ Error in process method:", error);
      console.error(
        "Error stack trace:",
        error instanceof Error ? error.stack : "No stack trace"
      );
      this.emitEvent(AgentEventType.AGENT_ERROR, null, error as Error);
      throw error;
    }
  }

  /**
   * Find relevant documentation files based on code changes
   */
  async findRelevantDocs(
    codeChanges: Array<{
      filename: string;
      patch?: string;
      additions: number;
      deletions: number;
    }>,
    commitMessage: string,
    docs: Array<{ path: string; content: string }>
  ): Promise<Array<{ path: string; content: string }>> {
    console.log(
      `🔍 Finding relevant docs for ${codeChanges.length} code changes with context-aware analysis`
    );

    // First, try to get relevant context from our knowledge base
    let contextEnhancedPrompt = "";
    try {
      const relevantContext = await this.aiService.getRelevantContext(
        `Documentation related to ${codeChanges
          .map((c) => c.filename)
          .join(", ")}`
      );

      if (
        relevantContext &&
        !relevantContext.includes("No knowledge base available")
      ) {
        contextEnhancedPrompt = `\nHere is relevant context from our knowledge base:
        ${relevantContext}\n`;
        console.log(
          `📚 Added ${
            relevantContext.split("\n").length
          } lines of relevant context`
        );
      }
    } catch (error) {
      console.warn(`⚠️ Error getting context from knowledge base: ${error}`);
    }

    const { text: analysis } = await generateText({
      model: this.aiService.model,
      system: `You are an expert at the Abstract SDK and documentation.
      Your task is to find which docs need updates based on code changes.
      
      Documentation Structure:
      - abstract-global-wallet/ - AGW SDK docs
      - how-abstract-works/ - Core concepts
      - infrastructure/ - Node and infrastructure docs
      - portal/ - Portal docs
      - tooling/ - Developer tools
      
      Only suggest updating docs that are actually impacted by the code changes.
      Focus on user-facing changes that need documentation.${contextEnhancedPrompt}`,
      prompt: `
      Here are the recent code changes:
      ${codeChanges
        .map(
          (change) => `
      File: ${change.filename}
      Additions: ${change.additions}
      Deletions: ${change.deletions}
      Patch: ${change.patch || "No patch available"}
      `
        )
        .join("\n\n")}

      Commit message: ${commitMessage}

      Here are all the documentation files:
      ${docs
        .map(
          (doc) => `
      Path: ${doc.path}
      First few lines:
      ${doc.content.split("\n").slice(0, 5).join("\n")}
      `
        )
        .join("\n\n")}

      Analyze the code changes and list ONLY the documentation files that need updates.
      Consider:
      1. What changed in the code?
      2. How does it affect users?
      3. Which docs explain this functionality?
      
      Return ONLY the file paths, one per line:
      `,
    });

    console.log(`🔍 AI analysis complete, parsing results`);

    // Parse the file paths from the response and find corresponding content
    const paths = analysis
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    console.log(`📋 Found ${paths.length} documentation files to update`);

    return paths.map((path) => {
      const doc = docs.find((d) => d.path === path);
      return { path, content: doc?.content || "" };
    });
  }

  /**
   * Start the agent
   * For webhook agents, this is a no-op as the agent is triggered by webhooks
   */
  protected async onStart(): Promise<void> {
    console.log(`🚀 ${this.name} started and waiting for webhook events`);
  }
}
