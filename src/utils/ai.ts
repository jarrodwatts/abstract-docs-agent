import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

/**
 * AI service for generating content using the Vercel AI SDK
 */
export class AIService {
  public model = openai("gpt-4o-mini");

  /**
   * Generate documentation updates based on code changes
   */
  async generateDocumentationUpdates(
    codeChanges: {
      filename: string;
      patch?: string;
      additions: number;
      deletions: number;
    }[],
    commitMessages: string[],
    existingDocs: { path: string; content: string }[]
  ): Promise<{ path: string; content: string; summary: string }[]> {
    const updates: { path: string; content: string; summary: string }[] = [];

    // For each existing doc, check if it needs updates based on code changes
    for (const doc of existingDocs) {
      const { text: updatedContent } = await generateText({
        model: this.model,
        system: `You are an expert technical writer for the Abstract Global Wallet (AGW) SDK.
        Your task is to update Mintlify documentation based on code changes.
        
        Documentation Style Guide:
        - This is a hand-written Mintlify docs site
        - Keep the existing MDX structure and components
        - Preserve existing sections and formatting
        - Only update sections relevant to the code changes
        - For API changes:
          - Update function signatures with proper types
          - Keep existing examples if still valid
          - Add new examples for new functionality
          - Update error cases with actual error messages
        - For changelogs:
          - Only document user-facing changes
          - Use actual version numbers
          - Link to relevant docs using Mintlify syntax
        - Never add auto-generated style content
        - Never change the overall structure
        - Focus on explaining changes to SDK users`,
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

        Here are the commit messages:
        ${commitMessages.join("\n")}

        Here is the existing documentation:
        Path: ${doc.path}
        Content:
        ${doc.content}

        Please provide the updated documentation content, preserving the existing Mintlify structure and components.
        Only update sections that are directly affected by the code changes.
        Keep all existing sections and formatting intact.
        `,
      });

      // Only include docs that have been changed
      if (updatedContent !== doc.content) {
        const { text: summary } = await generateText({
          model: this.model,
          system: `You are an expert technical writer summarizing documentation changes for the AGW SDK.
          Provide a concise, specific summary focused on the actual changes made.
          Do not use generic language or filler content.
          Reference actual function names, parameters, and types that were changed.`,
          prompt: `
          Original documentation:
          ${doc.path}
          ${doc.content}

          Updated documentation:
          ${updatedContent}

          Please provide a concise, specific summary of the actual changes made to the documentation.
          Focus on what was actually changed, not generic descriptions.
          `,
        });

        updates.push({
          path: doc.path,
          content: updatedContent,
          summary,
        });
      }
    }

    return updates;
  }

  /**
   * Generate a pull request title and description based on documentation updates
   */
  async generatePullRequestContent(
    updates: { path: string; summary: string }[]
  ): Promise<{ title: string; body: string }> {
    const { text: content } = await generateText({
      model: this.model,
      system: `You are an expert at creating clear, informative pull request descriptions for the Abstract docs site.
      Your task is to create a title and description for a pull request that updates Mintlify documentation.
      
      PR Style Guide:
      - Title should be concise and start with "docs:"
      - Description should:
        - List each file changed with specific sections updated
        - Reference the actual code changes that triggered the update
        - Explain how the docs help users understand the changes
        - Use Mintlify-style links when referencing other docs
      - Focus on clarity and usefulness for SDK users
      - Never include placeholder content or generic descriptions`,
      prompt: `
      The following documentation files have been updated:
      ${updates
        .map(
          (update) => `
      Path: ${update.path}
      Summary of changes: ${update.summary}
      `
        )
        .join("\n\n")}

      Please provide a pull request title and description in the following format:
      Title: docs: [Concise description of doc updates]

      Description:
      [Your PR description with Mintlify-style markdown formatting]
      `,
    });

    // Parse the title and body from the generated content
    const titleMatch = content.match(/Title: (.+)/);
    const title = titleMatch ? titleMatch[1] : "Documentation Updates";

    const bodyMatch = content.match(/Description:\s*([\s\S]+)/);
    const body = bodyMatch
      ? bodyMatch[1].trim()
      : "Updates to documentation based on recent code changes.";

    return { title, body };
  }

  /**
   * Analyze a code patch to determine which documentation sections it might affect
   */
  async analyzePatchForDocSections(
    patch: string,
    commitMessage: string,
    availableSections: string[]
  ): Promise<string[]> {
    const { text: analysis } = await generateText({
      model: this.model,
      system: `You are an expert at analyzing code changes for the Abstract SDK.
      Your task is to determine which documentation sections need updates based on code changes.
      
      You will be provided with:
      1. A code patch showing the actual changes
      2. A commit message explaining the changes
      3. A list of available documentation sections
      
      Return ONLY the section names that need updates, one per line.
      Do not include any explanatory text or sections that don't need changes.`,
      prompt: `
      Code changes:
      ${patch}

      Commit message:
      ${commitMessage}

      Available sections:
      ${availableSections.join("\n")}

      List ONLY the section names that need updates, one per line:`,
    });

    return analysis
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => availableSections.includes(line));
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
    availableDocs: Array<{
      path: string;
      content: string;
    }>
  ): Promise<Array<{ path: string }>> {
    const { text: analysis } = await generateText({
      model: this.model,
      system: `You are an expert at analyzing code changes for the Abstract SDK.
      Your task is to find documentation files that need updates based on code changes.
      
      You will be provided with:
      1. The code changes (files and patches)
      2. A commit message explaining the changes
      3. All available documentation files and their content
      
      Return ONLY the paths of documentation files that need updates, one per line.
      Do not include any explanatory text or files that don't need changes.`,
      prompt: `
      Code changes:
      ${codeChanges
        .map(
          (change) => `
      File: ${change.filename}
      Patch: ${change.patch || "No patch available"}
      `
        )
        .join("\n")}

      Commit message:
      ${commitMessage}

      Available documentation files:
      ${availableDocs
        .map(
          (doc) => `
      Path: ${doc.path}
      Content: ${doc.content}
      `
        )
        .join("\n")}

      List ONLY the documentation file paths that need updates, one per line:`,
    });

    return analysis
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => availableDocs.some((doc) => doc.path === line))
      .map((path) => ({ path }));
  }
}
