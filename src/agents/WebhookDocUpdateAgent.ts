import { BaseAgent } from "../core/BaseAgent.js";
import { GitHubSource } from "../sources/GitHubSource.js";
import { GitHubPROutput } from "../outputs/GitHubPROutput.js";
import { AgentEventType } from "../core/types.js";
import { Webhooks } from "@octokit/webhooks";
import { generateText } from "ai";
import path from "path";
import fs from "fs";
import { CodeChange } from "../utils/ai.js";

/**
 * Webhook Documentation Update Agent
 * 1: Listens for push events to the main branch of agw-sdk repository
 * 2: Uses AI to analyze the code changes and propose documentation updates
 * 3: Creates a PR with the documentation updates
 */
export class WebhookDocUpdateAgent extends BaseAgent {
  // Webhooks to listen to GitHub events
  public webhooks: Webhooks;

  private docsContent: Array<{
    type: string;
    name: string;
    path: string;
    content?: string;
    sha: string;
  }> = [];

  private knowledgeBasePath: string = "";
  private repoPath: string = "";
  private docsKnowledgeBasePath: string = "";

  private monitorRepoOwner: string = "";
  private monitorRepoName: string = "";
  private docsRepoOwner: string = "";
  private docsRepoName: string = "";
  private githubToken: string = "";

  constructor(
    id: string = "webhook-doc-update-agent",
    name: string = "Webhook Documentation Update Agent",
    description: string = "Responds to GitHub webhooks and proposes documentation updates"
  ) {
    super(id, name, description);
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

    // Fetches all documentation files from the docs repo and flattens them into a single array
    this.docsContent = await githubSource.getDocsContent(
      this.docsRepoOwner,
      this.docsRepoName
    );

    console.log(`📚 Loaded ${this.docsContent.length} documentation files`);

    // Log initialization
    console.log(
      `✅ Initialized ${this.name} to monitor ${this.monitorRepoOwner}/${this.monitorRepoName} and update docs in ${this.docsRepoOwner}/${this.docsRepoName}`
    );
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

        return isCodeFile && !isTestFile;
      });

      if (codeFileChanges.length === 0) {
        console.log("📭 No relevant SDK code changes");
        return;
      }

      console.log(`📋 Analyzing ${codeFileChanges.length} SDK files`);

      // Get context and generate summary with Joe
      const relevantContext = await this.joeService.getRelevantContext(
        `Code context for changes in ${codeFileChanges
          .map((c) => c.filename)
          .join(", ")}`
      );

      const codeSummary = await this.joeService.generateCodeSummary(
        codeFileChanges,
        relevantContext
      );

      console.log(`==============================
GENERATED CODE SUMMARY FROM JOE:

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
   * Start the agent
   * For webhook agents, this is a no-op as the agent is triggered by webhooks
   */
  protected async onStart(): Promise<void> {
    console.log(`🚀 ${this.name} started and waiting for webhook events`);
  }
}
