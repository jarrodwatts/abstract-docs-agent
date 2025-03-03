import { Output } from "../core/types.js";
import { Octokit } from "octokit";

export interface GitHubPRData {
  title: string;
  body: string;
  files: {
    path: string;
    content: string;
    message?: string;
  }[];
  baseBranch?: string;
  headBranch?: string;
}

export interface GitHubPROutputConfig {
  owner: string;
  repo: string;
  token: string;
  defaultBaseBranch?: string;
}

/**
 * Output that creates pull requests on GitHub
 */
export class GitHubPROutput implements Output<GitHubPRData> {
  id: string;
  name: string;
  description: string;
  private octokit: Octokit | null = null;
  private config: GitHubPROutputConfig | null = null;

  constructor(
    id: string = "github-pr-output",
    name: string = "GitHub PR Output",
    description: string = "Creates pull requests on GitHub"
  ) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async initialize(config: GitHubPROutputConfig): Promise<void> {
    if (!config.token) {
      throw new Error("GitHub token is required");
    }

    if (!config.owner || !config.repo) {
      throw new Error("GitHub owner and repo are required");
    }

    this.config = config;
    this.octokit = new Octokit({ auth: config.token });
  }

  /**
   * Create a pull request with the provided data
   */
  async sendData(data: GitHubPRData): Promise<void> {
    if (!this.octokit || !this.config) {
      throw new Error("GitHub PR output not initialized");
    }

    try {
      // Create a new branch for the changes
      const headBranch = data.headBranch || `docs-update-${Date.now()}`;
      const baseBranch =
        data.baseBranch || this.config.defaultBaseBranch || "main";

      // Get the SHA of the latest commit on the base branch
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${baseBranch}`,
      });

      const baseSha = refData.object.sha;

      // Create a new branch
      try {
        await this.octokit.rest.git.createRef({
          owner: this.config.owner,
          repo: this.config.repo,
          ref: `refs/heads/${headBranch}`,
          sha: baseSha,
        });
      } catch (error) {
        console.warn(`Branch ${headBranch} may already exist, continuing...`);
      }

      // Create or update files in the new branch
      for (const file of data.files) {
        try {
          // Check if the file already exists
          const { data: existingFile } =
            await this.octokit.rest.repos.getContent({
              owner: this.config.owner,
              repo: this.config.repo,
              path: file.path,
              ref: headBranch,
            });

          // Update the existing file
          if ("content" in existingFile && existingFile.content) {
            await this.octokit.rest.repos.createOrUpdateFileContents({
              owner: this.config.owner,
              repo: this.config.repo,
              path: file.path,
              message: file.message || `Update ${file.path}`,
              content: Buffer.from(file.content).toString("base64"),
              sha: existingFile.sha,
              branch: headBranch,
            });
          }
        } catch (error) {
          // File doesn't exist, create it
          await this.octokit.rest.repos.createOrUpdateFileContents({
            owner: this.config.owner,
            repo: this.config.repo,
            path: file.path,
            message: file.message || `Create ${file.path}`,
            content: Buffer.from(file.content).toString("base64"),
            branch: headBranch,
          });
        }
      }

      // Create a pull request
      await this.octokit.rest.pulls.create({
        owner: this.config.owner,
        repo: this.config.repo,
        title: data.title,
        body: data.body,
        head: headBranch,
        base: baseBranch,
      });
    } catch (error) {
      console.error("Error creating pull request:", error);
      throw error;
    }
  }
}
