import express from "express";
import dotenv, { config } from "dotenv";
import { Octokit } from "octokit";
import { Webhooks } from "@octokit/webhooks";
import getDocsContent, { generateDirectoryTree } from "./getDocsRepoContent.js";
import { generateText, tool } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

// Load environment variables
dotenv.config();

/**
 * Main entry point for the webhook server
 */
async function main() {
  console.log("Starting Abstract docs maintenance agent...");

  try {
    // Setup listening to GitHub commits to main branch on agw-sdk.
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN! });
    const webhooks = new Webhooks({
      secret: process.env.GITHUB_WEBHOOK_SECRET!,
    });

    // Listen for push events to agw-sdk main branch
    webhooks.on("push", async ({ payload }) => {
      // Get the latest commit from the push event
      const latestCommit = await octokit.rest.repos.getCommit({
        owner: process.env.MONITOR_REPO_OWNER!,
        repo: process.env.MONITOR_REPO_NAME!,
        ref: payload.after,
      });

      // Check if the commit has any changed files
      if (!latestCommit.data.files) {
        console.log("⛔ No files found in commit");
        return;
      }

      // Filter down each of the changed files
      // 1. Should not include .md files such as CHANGELOG.md or README.md
      // 2. Should not include config files like .yaml or .json
      // 3. Should not include test files like signTransaction.test.ts
      const filteredChangedFiles = latestCommit.data.files.filter(
        (file) => !file.filename.match(/\.(md|yaml|json|test\.ts)$/)
      );

      // Extract the diff for each of the changed files.
      // e.g. @@ -74,7 +74,7 @@ Enhancement suggestions are tracked as
      const filteredChangedFileDetails = await Promise.all(
        filteredChangedFiles.map(async (file) => {
          // Get the full file contents using Octokit
          const fileResponse = await octokit.rest.repos.getContent({
            owner: process.env.MONITOR_REPO_OWNER!,
            repo: process.env.MONITOR_REPO_NAME!,
            path: file.filename,
            ref: payload.after, // Use the latest commit ref
          });

          // The content is base64 encoded, so we need to decode it
          const fileContent = Buffer.from(
            (fileResponse.data as any).content,
            "base64"
          ).toString();

          return {
            path: file.filename,
            fileContents: fileContent,
            diff: file.patch || "",
          };
        })
      );

      // If there are no filtered diffs, log and return
      if (filteredChangedFileDetails.length === 0) {
        console.log("⛔ No relevant downstream changes found in commit");
        return;
      }

      console.log(
        `🔍 Found ${filteredChangedFileDetails.length} relevant downstream changes in commit`
      );

      // Get the content of the docs repo
      const docsContent = await getDocsContent(octokit);
      const docsTreeStructure = await generateDirectoryTree(docsContent);

      const results: string[] = [];

      // Iterate over the filtered changed file diffs.
      for (const file of filteredChangedFileDetails) {
        // Add a short delay between LLM calls to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2500)); // 2.5 second delay

        console.log(`🔍 Processing next file: ${file.path}`);

        // - Ask AI to find the most relevant file in the documentation that needs to be updated.
        const { text, finishReason } = await generateText({
          model: openai("gpt-4o-mini"),
          tools: {
            getDocContent: tool({
              description:
                "Get the contents of a file in the documentation repo given the full path.",
              parameters: z.object({
                path: z
                  .string()
                  .describe(
                    `The full path to the file in the documentation repo from: ${docsTreeStructure}`
                  ),
              }),
              execute: async ({ path }) => {
                console.log(`🔍 Getting doc content for ${path}`);
                try {
                  const doc = docsContent.find((doc) => doc.path === path);
                  return doc?.content;
                } catch (error) {
                  console.error(
                    `Error getting doc content for ${path}:`,
                    error
                  );
                  return null;
                }
              },
            }),
          },
          maxSteps: 2,

          system: `You are a documentation maintenance agent for Abstract.
        
        Your role is to identify what file paths in the documentation repo require updates based on recent changes to the Abstract Global Wallet SDK.

        In each prompt, you will be given:
          - A diff for the changed file in the SDK.
          - The tree structure of the documentation repo as it exists on GitHub.

        You are provided with a tool where you can lookup the contents of a file in the documentation repo, given the full path.
        You should make use of this tool to find the most relevant section of the documentation that needs to be updated.

        For each of the SDK diffs, you should:
          - Use both the tree and contents of the docs to find the most relevant section of the documentation that needs to be updated.
        
        If you cannot find the relevant section of the documentation tree, print an explanation of your thinking.`,

          prompt: `Please review the following SDK diff and the current documentation content, and provide the EXACT full file path to the documentation file that needs to be updated.

          File changed: ${file.path}

          File contents:
          ${file.fileContents}

          Git Diff:
          ${file.diff}

          Documentation Tree Structure:
          ${docsTreeStructure}
          
          Please provide the following outputs in dotpoint format:
            - PATH: The full file path to the documentation file that needs to be updated.
            - CONTENT: Using the getDocContent tool, identify the most relevant section of the documentation that needs to be updated and apply the changes to the content.
            - EXPLANATION: An explanation of your thinking.
          `,
        });

        console.log(`🔍 Finish reason: ${finishReason}`);
        console.log(`🔍 Result: ${text.length} characters`);
        results.push(text);
      }

      console.log(
        `🔍 Finished processing all files. Results size is: ${results.length}`
      );
      // Given the docs content and the filtered changed file diffs, we can now
      // ask AI to determine what changes need to be made to the docs repo.

      console.log(`🔍 Beginning to apply changes to docs repo...`);
      for (const result of results) {
        if (result.length === 0) {
          console.log("⛔ No changes found for this result");
          continue;
        }

        console.log(`🔍 Processing next result: ${result.length} characters`);
        try {
          // Add a short delay between LLM calls to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 2500)); // 2.5 second delay

          // Now we have the suggested changes, lets run them through the next agent to apply them to the docs repo.
          const { text: updatedDocs } = await generateText({
            model: openai("gpt-4o-mini"),
            maxSteps: 2,
            tools: {
              getDocContent: tool({
                description:
                  "Get the contents of a file in the documentation repo given the full path.",
                parameters: z.object({
                  path: z
                    .string()
                    .describe(
                      `The full path to the file in the documentation repo from: ${docsTreeStructure}`
                    ),
                }),
                execute: async ({ path }) => {
                  console.log(`🔍 Getting doc content for ${path}`);
                  let doc = docsContent.find((doc) => doc.path === path);

                  if (!doc) {
                    // try prepend abstract-global-wallet to the path
                    const newPath = `abstract-global-wallet/${path}`;
                    doc = docsContent.find((doc) => doc.path === newPath);
                  }

                  if (!doc) {
                    console.error(`Error getting doc content for ${path}`);
                    throw new Error(`Error getting doc content for ${path}`);
                  }

                  return doc?.content;
                },
              }),
              createPullRequest: tool({
                description:
                  "Create a pull request with the updated documentation file to the abstract-docs repo.",
                parameters: z.object({
                  path: z
                    .string()
                    .describe(
                      "The full path to the file in the documentation repo"
                    ),
                  title: z.string().describe("The title of the pull request"),
                  description: z
                    .string()
                    .describe("The description of the pull request"),
                  content: z
                    .string()
                    .describe("The updated content of the documentation file"),
                }),
                execute: async ({ path, title, description, content }) => {
                  console.log(`🔍 Creating pull request for ${path}`);
                  console.log(`🔍 Title: ${title}`);
                  console.log(`🔍 Description: ${description}`);
                  console.log(`🔍 Content: ${content.length} characters`);

                  try {
                    // Get the default branch of the docs repo
                    const { data: repo } = await octokit.rest.repos.get({
                      owner: process.env.DOCS_REPO_OWNER!,
                      repo: process.env.DOCS_REPO_NAME!,
                    });

                    const defaultBranch = repo.default_branch;

                    // Create a new branch for the PR
                    const timestamp = new Date().getTime();
                    const branchName = `docs-update-${timestamp}`;

                    // Get the SHA of the latest commit on the default branch
                    const { data: refData } = await octokit.rest.git.getRef({
                      owner: process.env.DOCS_REPO_OWNER!,
                      repo: process.env.DOCS_REPO_NAME!,
                      ref: `heads/${defaultBranch}`,
                    });

                    const sha = refData.object.sha;

                    // Create a new branch based on the default branch
                    await octokit.rest.git.createRef({
                      owner: process.env.DOCS_REPO_OWNER!,
                      repo: process.env.DOCS_REPO_NAME!,
                      ref: `refs/heads/${branchName}`,
                      sha,
                    });

                    // Get the current file content to obtain its SHA
                    let fileSha;
                    try {
                      const { data: fileData } =
                        await octokit.rest.repos.getContent({
                          owner: process.env.DOCS_REPO_OWNER!,
                          repo: process.env.DOCS_REPO_NAME!,
                          path,
                          ref: branchName,
                        });

                      if (!Array.isArray(fileData)) {
                        fileSha = fileData.sha;
                      }
                    } catch (error) {
                      // File might not exist yet, which is fine for new files
                      console.log(`File doesn't exist yet, creating new file`);
                    }

                    // Update the file content in the new branch
                    await octokit.rest.repos.createOrUpdateFileContents({
                      owner: process.env.DOCS_REPO_OWNER!,
                      repo: process.env.DOCS_REPO_NAME!,
                      path,
                      message: `Update ${path}`,
                      content: Buffer.from(content).toString("base64"),
                      branch: branchName,
                      sha: fileSha, // Only needed for updating existing files
                    });

                    // Create a pull request
                    const { data: pullRequest } =
                      await octokit.rest.pulls.create({
                        owner: process.env.DOCS_REPO_OWNER!,
                        repo: process.env.DOCS_REPO_NAME!,
                        title: `[TRIGGERED BY BOT] - ${title}`,
                        body: description,
                        head: branchName,
                        base: defaultBranch,
                      });

                    console.log(
                      `✅ Pull request created successfully: ${pullRequest.html_url}`
                    );

                    return {
                      success: true,
                      url: pullRequest.html_url,
                      message: `Pull request created successfully: ${pullRequest.html_url}`,
                    };
                  } catch (error: unknown) {
                    console.error(`❌ Error creating pull request:`, error);
                    const errorMessage =
                      error instanceof Error ? error.message : String(error);
                    return {
                      success: false,
                      error: `Failed to create pull request: ${errorMessage}`,
                    };
                  }
                },
              }),
            },

            system: `You are a documentation maintenance agent for Abstract.
        
        Your role is to apply the suggested changes to the documentation repo.
        
        You will be given suggested changes to the documentation.
        
        Given these suggestions, you will:
        - 1. Find the documentation file that is suggested to be updated from the list.
        - 2. Use the getDocContent tool to get the full content of the documentation file.
        - 3. Apply the suggested changes to the documentation file.
        - 4. Use the createPullRequest tool to create a pull request with the updated documentation file to the abstract-docs repo.
        
        IMPORTANT: Always follow these steps in order. First get the document content, then create a pull request with your changes.
        `,
            prompt: `Please apply the following changes to the documentation repo:
            
            ${result}
            
            First, use getDocContent to retrieve the current content of the file.
            Then, create a pull request with your changes using the createPullRequest tool.`,
          });

          console.log(`🔍 Updated docs: ${updatedDocs}`);
        } catch (error) {
          console.error(`Error processing result:`, error);
        }
      }
    });

    // Create Express server
    const app = express();

    // Parse raw body for webhook verification
    app.use("/webhook", express.raw({ type: "*/*" }));
    // Parse JSON for other routes
    app.use(express.json());

    // Set up a route for GitHub webhooks with error handling
    app.post("/webhook", async (req, res) => {
      try {
        // Get the event type from headers
        const eventHeader = req.headers["x-github-event"];
        const signatureHeader = req.headers["x-hub-signature-256"];
        const deliveryHeader = req.headers["x-github-delivery"];

        // Ensure headers are strings
        const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
        const signature = Array.isArray(signatureHeader)
          ? signatureHeader[0]
          : signatureHeader;
        const delivery = Array.isArray(deliveryHeader)
          ? deliveryHeader[0]
          : deliveryHeader;

        if (!event || !signature || !delivery) {
          throw new Error("Missing required webhook headers");
        }

        // First verify the webhook with the raw body
        await webhooks.verify(
          req.body.toString("utf8"), // Convert Buffer to string
          signature
        );

        // Now decode and parse the payload
        const rawBody = req.body.toString("utf8");

        const decodedPayload = decodeURIComponent(
          rawBody.replace(/^payload=/, "")
        );

        // Parse the JSON payload
        const jsonPayload = JSON.parse(decodedPayload);

        // Process the webhook with the parsed payload
        await webhooks
          .receive({
            id: delivery,
            name: event as "push" | "pull_request",
            payload: jsonPayload,
          })
          .catch((error) => {
            console.error("Error in webhook handler:", error);
            throw error;
          });

        // If we get here, webhook was processed successfully
        res.status(200).json({ message: "Webhook processed successfully" });
      } catch (error: any) {
        console.error("Error processing webhook:", error);
        if (!res.headersSent) {
          if (error.message?.includes("signature")) {
            res.status(401).json({ error: "Invalid webhook signature" });
          } else {
            res.status(500).json({ error: "Error processing webhook" });
          }
        }
      }
    });

    // Add a simple health check endpoint
    app.get("/health", (req, res) => {
      res.status(200).send("Webhook server is running");
    });

    // Start the server
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Webhook server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting Abstract Agents webhook server:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error);
