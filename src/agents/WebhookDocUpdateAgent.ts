import { BaseAgent } from "../core/BaseAgent.js";
import { GitHubSource } from "../sources/GitHubSource.js";
import { GitHubPROutput } from "../outputs/GitHubPROutput.js";
import { AIService } from "../utils/ai.js";
import { AgentEventType } from "../core/types.js";
import { Webhooks } from "@octokit/webhooks";
import { createNodeMiddleware } from "@octokit/webhooks";
import { generateText } from "ai";

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

    console.log(`Loaded ${this.docsContent.length} documentation files`);

    // Log initialization
    console.log(
      `Initialized ${this.name} to monitor ${this.monitorRepoOwner}/${this.monitorRepoName} and update docs in ${this.docsRepoOwner}/${this.docsRepoName}`
    );
  }

  /**
   * Set up webhook handlers for GitHub events
   */
  private setupWebhookHandlers(): void {
    // Handle push events
    this.webhooks.on("push", async ({ payload }) => {
      try {
        console.log("Full webhook payload:", JSON.stringify(payload, null, 2));
        console.log(`Received push event from ${payload.repository.full_name}`);
        console.log(
          "Payload owner:",
          JSON.stringify(payload.repository.owner, null, 2)
        );
        console.log("Expected owner:", this.monitorRepoOwner);

        // Check if the push is to the monitored repository
        if (
          payload.repository.owner &&
          (payload.repository.owner.name === this.monitorRepoOwner ||
            payload.repository.owner.login === this.monitorRepoOwner)
        ) {
          console.log(
            `Processing push event for ${payload.repository.full_name}`
          );

          // Reset the last checked SHA in the GitHub source to ensure we get the latest commits
          console.log("Resetting last checked SHA");
          const githubSource = this.sources[0] as GitHubSource;
          githubSource.resetLastChecked();

          // Process the changes
          console.log("Starting process() method");
          await this.process().catch((error) => {
            console.error("Error in process() method:", error);
            throw error;
          });
          console.log("Finished process() method");
        } else {
          console.log("Repository mismatch. Skipping processing.");
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
        console.error("Error in push event handler:", error);
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
        console.log(`Processing merged PR #${payload.pull_request.number}`);

        // Reset the last checked SHA in the GitHub source
        const githubSource = this.sources[0] as GitHubSource;
        githubSource.resetLastChecked();

        // Process the changes
        await this.process();
      }
    });

    // Add an error handler for the webhooks instance
    this.webhooks.onError((error) => {
      console.error("Webhook error occurred:", error);
    });

    // Add a before hook to log incoming webhooks
    this.webhooks.onAny(async ({ id, name, payload }) => {
      console.log(`Received webhook ${name} with id ${id}`);
    });
  }

  /**
   * Get the middleware for handling webhook requests
   */
  getWebhookMiddleware() {
    // Log the webhook secret being used (but not the actual value)
    console.log(
      "Webhook secret configured:",
      !!process.env.GITHUB_WEBHOOK_SECRET
    );

    // Create the middleware with verification options
    const middleware = createNodeMiddleware(this.webhooks, {
      path: "/",
      log: {
        debug: (message) => console.log("Webhook Debug:", message),
        info: (message) => console.log("Webhook Info:", message),
        warn: (message) => console.warn("Webhook Warning:", message),
        error: (message) => console.error("Webhook Error:", message),
      },
    });

    // Return a middleware function that verifies and processes the webhook
    return (req: any, res: any, next: any) => {
      console.log("Starting webhook verification");

      // Process the webhook directly
      this.webhooks
        .verifyAndReceive({
          id: req.headers["x-github-delivery"],
          name: req.headers["x-github-event"],
          payload: req.body,
          signature: req.headers["x-hub-signature-256"],
        })
        .then(() => {
          console.log("Webhook processed successfully");
          next();
        })
        .catch((error) => {
          console.error("Error processing webhook:", error);
          next(error);
        });
    };
  }

  /**
   * Process data from sources and generate documentation updates
   */
  async process(): Promise<void> {
    try {
      console.log("STEP 1: Starting process method");

      // Get the GitHub source
      console.log("STEP 2: Getting GitHub source");
      const githubSource = this.sources[0] as GitHubSource;
      if (!githubSource) throw new Error("GitHub source not found");
      console.log("STEP 2: Got GitHub source successfully");

      // Get the GitHub output
      console.log("STEP 3: Getting GitHub output");
      const githubOutput = this.outputs[0] as GitHubPROutput;
      if (!githubOutput) throw new Error("GitHub output not found");
      console.log("STEP 3: Got GitHub output successfully");

      // Get recent commits
      console.log("STEP 4: Getting latest commit");
      const commit = await githubSource.getData();
      console.log("STEP 4: Got commit:", commit ? "yes" : "no");

      if (!commit) {
        console.log("No new commit found");
        return;
      }

      console.log("STEP 5: Processing new commit");
      console.log("Commit details:", {
        sha: commit.sha,
        message: commit.message,
        files: commit.files?.length || 0,
      });

      // Extract code changes from commit
      console.log("STEP 6: Extracting code changes");
      const codeChanges = (commit.files || []).map((file) => ({
        filename: file.filename,
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
      }));
      console.log("STEP 6: Code changes extracted:", codeChanges.length);

      // Analyze code changes
      console.log("STEP 7: Analyzing code changes");
      const relevantDocs = await this.findRelevantDocs(
        codeChanges,
        commit.message,
        this.docsContent.map((doc) => ({
          path: doc.path,
          content: doc.content || "",
        }))
      );
      console.log(
        "STEP 8: Analysis complete. Relevant docs:",
        relevantDocs.map((doc) => doc.path)
      );

      if (relevantDocs.length === 0) {
        console.log("No documentation updates needed");
        return;
      }

      console.log(
        `STEP 9: Identified ${relevantDocs.length} documentation files that might need updates`
      );

      // Generate documentation updates
      console.log("STEP 10: Generating documentation updates");
      const updates = await Promise.all(
        relevantDocs.map(async (doc) => {
          const updatedContent =
            await this.aiService.generateDocumentationUpdates(
              codeChanges,
              [commit.message],
              [
                {
                  path: doc.path,
                  content: doc.content || "",
                },
              ]
            );
          return updatedContent[0];
        })
      );

      if (!updates || updates.length === 0) {
        console.log("No documentation updates generated");
        return;
      }

      console.log(
        `STEP 11: Generated updates for ${updates.length} documentation files`
      );

      // Generate pull request content
      console.log("STEP 12: Generating PR content");
      const { title, body } = await this.aiService.generatePullRequestContent(
        updates.map((update) => ({
          path: update.path,
          summary: update.summary,
        }))
      );

      // Create a pull request with the updates
      console.log("STEP 13: Creating pull request");
      await githubOutput.sendData({
        title,
        body,
        files: updates.map((update) => ({
          path: update.path,
          content: update.content,
          message: `Update ${update.path} based on recent code changes`,
        })),
      });

      console.log("STEP 13: Pull request created successfully");
      console.log(`Created pull request: ${title}`);

      // Emit event for successful processing
      this.emitEvent(AgentEventType.OUTPUT_DATA_SENT, {
        title,
        updatedFiles: updates.map((update) => update.path),
      });
    } catch (error) {
      console.error("Error in process method:", error);
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
      Focus on user-facing changes that need documentation.`,
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

    // Parse the file paths from the response and find corresponding content
    const paths = analysis
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

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
    console.log(`${this.name} started and waiting for webhook events`);
  }
}
