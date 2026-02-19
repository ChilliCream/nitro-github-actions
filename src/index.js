const core = require("@actions/core");
const github = require("@actions/github");
const exec = require("@actions/exec");
const tc = require("@actions/tool-cache");
const path = require("path");
const os = require("os");

function getPlatformInfo() {
  const platform = os.platform();
  const arch = os.arch();

  let osType, archType;

  // Determine OS
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

  // Determine architecture
  switch (arch) {
    case "x64":
    case "x86_64":
      archType = "x64";
      break;
    case "arm64":
    case "aarch64":
      archType = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  return { osType, archType };
}

async function getVersion(version) {
  // TODO: We need to check how this works with prereleases
  //       and it also shouldn't be installing versions < 16 if we publish them...
  if (version === "latest") {
    const latestUrl =
      "https://api.github.com/repos/ChilliCream/graphql-platform/releases/latest";
    const response = await exec.getExecOutput("curl", ["-s", latestUrl]);
    const release = JSON.parse(response.stdout);

    return release.tag_name;
  }

  return version;
}

async function installNitro(version = "latest") {
  try {
    const { osType, archType } = getPlatformInfo();
    const resolvedVersion = await getVersion(version);

    const binaryName = osType === "win" ? "nitro.exe" : "nitro";
    const toolName = "nitro";

    let toolPath = tc.find(toolName, resolvedVersion);

    if (!toolPath) {
      const downloadUrl = `https://github.com/ChilliCream/graphql-platform/releases/download/${resolvedVersion}/nitro-${osType}-${archType}.zip`;

      core.info(`Downloading Nitro CLI from: ${downloadUrl}`);

      const downloadPath = await tc.downloadTool(downloadUrl);

      const extractPath = await tc.extractZip(downloadPath);

      toolPath = await tc.cacheDir(extractPath, toolName, resolvedVersion);
    }

    core.addPath(toolPath);

    if (osType !== "win") {
      const binaryPath = path.join(toolPath, binaryName);
      await exec.exec("chmod", ["+x", binaryPath]);
    }
  } catch (error) {
    core.setFailed(`Failed to install Nitro CLI: ${error.message}`);
    throw error;
  }
}

function getSourceMetadata() {
  const { context } = github;

  const commitSha = context.sha;
  const repositoryUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`;
  const actor = context.actor;

  let runUrl = `${repositoryUrl}/actions/runs/${context.runId}`;
  if (context.runAttempt > 0) {
    runUrl += `/attempts/${context.runAttempt}`;
  }

  return { commitSha, actor, repositoryUrl, runUrl };
}

module.exports = { installNitro, getSourceMetadata };
