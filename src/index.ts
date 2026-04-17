import * as core from "@actions/core";
import * as github from "@actions/github";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as path from "path";
import * as os from "os";

export type CommentMode = "comment" | "review" | "none";

export function getCommentMode(): CommentMode {
  const commentMode = (core.getInput("comment-mode") || "none")
    .trim()
    .toLowerCase();

  if (
    commentMode === "comment" ||
    commentMode === "review" ||
    commentMode === "none"
  ) {
    return commentMode;
  }

  throw new Error(
    `Invalid comment-mode "${commentMode}". Expected one of: comment, review, none.`,
  );
}

function getPlatformInfo() {
  const platform = os.platform();
  const arch = os.arch();

  let osType: "osx" | "linux" | "win";
  let archType: "x64" | "arm64";

  switch (platform) {
    case "darwin":
      osType = "osx";
      break;
    case "linux":
      osType = "linux";
      break;
    case "win32":
      osType = "win";
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  switch (arch) {
    case "x64":
      archType = "x64";
      break;
    case "arm64":
      archType = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  return { osType, archType };
}

export async function installNitro(version: string) {
  const { osType, archType } = getPlatformInfo();

  const binaryName = osType === "win" ? "nitro.exe" : "nitro";
  const toolName = "nitro";

  let toolPath = tc.find(toolName, version);

  if (!toolPath) {
    const extension = osType === "win" ? "zip" : "tar.gz";
    const downloadUrl = `https://github.com/ChilliCream/graphql-platform/releases/download/${version}/nitro-${osType}-${archType}.${extension}`;

    core.info(`Downloading Nitro CLI from: ${downloadUrl}`);

    const downloadPath = await tc.downloadTool(downloadUrl);

    const extractPath =
      osType === "win"
        ? await tc.extractZip(downloadPath)
        : await tc.extractTar(downloadPath);

    toolPath = await tc.cacheDir(extractPath, toolName, version);
  }

  core.addPath(toolPath);

  if (osType !== "win") {
    const binaryPath = path.join(toolPath, binaryName);
    await exec.exec("chmod", ["+x", binaryPath]);
  }
}

export function getSourceMetadata(jobId?: string) {
  const { context } = github;

  const repositoryUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`;

  return {
    actor: context.actor,
    commitHash: context.sha,
    workflowName: context.workflow,
    runNumber: context.runNumber.toString(),
    runId: context.runId.toString(),
    jobId,
    repositoryUrl,
  };
}

async function upsertComment(id: string, markdown: string) {
  if (!id.trim()) {
    throw new Error("Comment id must not be empty.");
  }

  if (!markdown.trim()) {
    throw new Error("Comment markdown must not be empty.");
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is required to upsert pull request comments.",
    );
  }

  const pullRequestNumber = github.context.payload.pull_request?.number;

  if (!pullRequestNumber) {
    throw new Error("upsertComment can only be used in pull_request contexts.");
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const marker = `<!-- nitro-comment:${encodeURIComponent(id)} -->`;
  const body = `${marker}\n${markdown}`;

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullRequestNumber,
    per_page: 100,
  });

  const existingComment = comments.find((comment) =>
    comment.body?.includes(marker),
  );

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullRequestNumber,
      body,
    });
  }
}

export async function removeComment(id: string) {
  if (!id.trim()) {
    throw new Error("Comment id must not be empty.");
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is required to remove pull request comments.",
    );
  }

  const pullRequestNumber = github.context.payload.pull_request?.number;

  if (!pullRequestNumber) {
    throw new Error("removeComment can only be used in pull_request contexts.");
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const marker = `<!-- nitro-comment:${encodeURIComponent(id)} -->`;

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullRequestNumber,
    per_page: 100,
  });

  const matchingComments = comments.filter((comment) =>
    comment.body?.includes(marker),
  );

  for (const comment of matchingComments) {
    await octokit.rest.issues.deleteComment({
      owner,
      repo,
      comment_id: comment.id,
    });
  }
}

async function upsertReview(
  id: string,
  markdown: string,
  eventType: "COMMENT" | "REQUEST_CHANGES",
) {
  if (!id.trim()) {
    throw new Error("Review id must not be empty.");
  }

  if (!markdown.trim()) {
    throw new Error("Review markdown must not be empty.");
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is required to upsert pull request reviews.");
  }

  const pullRequestNumber = github.context.payload.pull_request?.number;

  if (!pullRequestNumber) {
    throw new Error("upsertReview can only be used in pull_request contexts.");
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const marker = `<!-- nitro-review:${encodeURIComponent(id)} -->`;
  const body = `${marker}\n${markdown}`;

  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: pullRequestNumber,
    per_page: 100,
  });

  const existingReview = reviews.find((review) =>
    review.body?.includes(marker),
  );

  if (existingReview && existingReview.state === "CHANGES_REQUESTED") {
    await octokit.rest.pulls.updateReview({
      owner,
      repo,
      pull_number: pullRequestNumber,
      review_id: existingReview.id,
      body,
    });
  } else {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullRequestNumber,
      body,
      event: eventType,
    });
  }
}

export async function upsertPullRequestReviewComment(
  /** A unique identifier for the comment */
  id: string,
  /** The markdown content of the comment */
  markdown: string,
  /** The mode of the comment, either "comment" or "review" */
  commentMode: Exclude<CommentMode, "none"> = "review",
  /** Whether the comment has validation errors - if true, a review will request changes */
  hasValidationErrors: boolean = false,
) {
  if (commentMode === "comment") {
    await upsertComment(id, markdown);
  } else if (commentMode === "review") {
    await upsertReview(
      id,
      markdown,
      hasValidationErrors ? "REQUEST_CHANGES" : "COMMENT",
    );
  } else {
    throw new Error(
      `Invalid comment-mode "${commentMode}". Expected one of: comment, review.`,
    );
  }
}
