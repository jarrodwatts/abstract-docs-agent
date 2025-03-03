import { Source } from "../core/types.js";
import { Octokit } from "octokit";

export interface GitHubCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  url: string;
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }[];
}

export interface GitHubSourceConfig {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
  since?: string; // ISO date string
}

/**
 * Source that fetches commits and changes from a GitHub repository
 */
export class GitHubSource implements Source<GitHubCommit | null> {
  id: string;
  name: string;
  description: string;
  private octokit: Octokit | null = null;
  private config: GitHubSourceConfig | null = null;
  private lastCheckedSha: string | null = null;

  constructor(
    id: string = "github-source",
    name: string = "GitHub Source",
    description: string = "Fetches commits and changes from a GitHub repository"
  ) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async initialize(config: GitHubSourceConfig): Promise<void> {
    if (!config.token) {
      throw new Error("GitHub token is required");
    }

    if (!config.owner || !config.repo) {
      throw new Error("GitHub owner and repo are required");
    }

    this.config = config;
    this.octokit = new Octokit({ auth: config.token });

    // Get the latest commit SHA to use as a starting point
    if (!this.lastCheckedSha) {
      const latestCommit = await this.getLatestCommit();
      if (latestCommit) {
        this.lastCheckedSha = latestCommit.sha;
      }
    }
  }

  /**
   * Get the latest commit from the repository
   */
  private async getLatestCommit(): Promise<{ sha: string } | null> {
    if (!this.octokit || !this.config) {
      throw new Error("GitHub source not initialized");
    }

    try {
      const { data: commits } = await this.octokit.rest.repos.listCommits({
        owner: this.config.owner,
        repo: this.config.repo,
        per_page: 1,
        ...(this.config.branch ? { sha: this.config.branch } : {}),
      });

      if (commits.length > 0) {
        return { sha: commits[0].sha };
      }

      return null;
    } catch (error) {
      console.error("Error fetching latest commit:", error);
      return null;
    }
  }

  /**
   * Get new commits since the last check
   */
  async getData(): Promise<GitHubCommit | null> {
    if (!this.octokit || !this.config) {
      throw new Error("GitHub source not initialized");
    }

    // Store non-null values to help TypeScript understand they can't be null
    const octokit = this.octokit;
    const config = this.config;

    try {
      console.log("Fetching latest commit");
      // Get the latest commit
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner: config.owner,
        repo: config.repo,
        ...(config.branch ? { sha: config.branch } : {}),
        ...(config.since ? { since: config.since } : {}),
        per_page: 1,
      });

      // If no commits found
      if (commits.length === 0) {
        return null;
      }

      const latestCommit = commits[0];

      // If this commit was already processed, skip it
      if (this.lastCheckedSha === latestCommit.sha) {
        return null;
      }

      // Update the last checked SHA
      this.lastCheckedSha = latestCommit.sha;

      console.log(`Fetching details for commit ${latestCommit.sha}`);

      // Get detailed information for the commit
      const { data: commitData } = await octokit.rest.repos.getCommit({
        owner: config.owner,
        repo: config.repo,
        ref: latestCommit.sha,
      });

      const author = commitData.commit?.author;
      const detailedCommit: GitHubCommit = {
        sha: latestCommit.sha,
        message: commitData.commit?.message || "",
        author: {
          name: author?.name || "Unknown",
          email: author?.email || "unknown@example.com",
          date: author?.date || new Date().toISOString(),
        },
        url: commitData.html_url || "",
        files:
          commitData.files?.map((file) => ({
            filename: file.filename || "",
            status: file.status || "modified",
            additions: file.additions || 0,
            deletions: file.deletions || 0,
            changes: file.changes || 0,
            patch: file.patch,
          })) || [],
      };

      return detailedCommit;
    } catch (error) {
      console.error("Error fetching commits:", error);
      return null;
    }
  }

  /**
   * Reset the last checked SHA to force fetching all commits again
   */
  resetLastChecked(): void {
    this.lastCheckedSha = null;
  }

  /**
   * Fetch content from the documentation repository
   * @param owner The owner of the docs repository
   * @param repo The name of the docs repository
   * @param path Optional path within the repository
   * @returns The repository content
   */
  async getDocsContent(
    owner: string,
    repo: string,
    path: string = ""
  ): Promise<
    Array<{
      type: string;
      name: string;
      path: string;
      content?: string;
      sha: string;
    }>
  > {
    if (!this.octokit) {
      throw new Error("GitHub source not initialized");
    }

    const octokit = this.octokit; // Store in local variable to help TypeScript

    try {
      // Get the contents of the path
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
      });

      // If data is an array, it's a directory listing
      if (Array.isArray(data)) {
        // Recursively get content of all files
        const contents = await Promise.all(
          data.map(async (item) => {
            if (item.type === "dir") {
              // Recursively get directory contents
              const dirContents = await this.getDocsContent(
                owner,
                repo,
                item.path
              );
              return dirContents;
            } else if (
              item.type === "file" &&
              (item.name.endsWith(".md") || item.name.endsWith(".mdx"))
            ) {
              // Get file content for markdown files
              const { data: fileData } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: item.path,
              });

              if ("content" in fileData) {
                return [
                  {
                    type: "file",
                    name: item.name,
                    path: item.path,
                    content: Buffer.from(fileData.content, "base64").toString(
                      "utf-8"
                    ),
                    sha: item.sha,
                  },
                ];
              }
            }
            return [];
          })
        );

        // Flatten the array of arrays
        return contents.flat();
      }

      return [];
    } catch (error) {
      console.error("Error fetching docs content:", error);
      return [];
    }
  }
}
