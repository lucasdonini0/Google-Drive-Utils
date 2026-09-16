const elements = {
  authButton: document.querySelector("#auth-button"),
  accountName: document.querySelector("#account-name"),
  folderUrl: document.querySelector("#folder-url"),
  scanButton: document.querySelector("#scan-button"),
  message: document.querySelector("#message"),
  optionsCard: document.querySelector("#options-card"),
  folderName: document.querySelector("#folder-name"),
  folderStats: document.querySelector("#folder-stats"),
  perFolderChoice: document.querySelector("#per-folder-choice"),
  destination: document.querySelector("#destination"),
  browseButton: document.querySelector("#browse-button"),
  downloadButton: document.querySelector("#download-button"),
  progressCard: document.querySelector("#progress-card"),
  progressPhase: document.querySelector("#progress-phase"),
  progressTitle: document.querySelector("#progress-title"),
  progressPercent: document.querySelector("#progress-percent"),
  progressBar: document.querySelector("#progress-bar"),
  progressDetail: document.querySelector("#progress-detail"),
  cancelButton: document.querySelector("#cancel-button"),
  resultCard: document.querySelector("#result-card"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),
  failureList: document.querySelector("#failure-list"),
  retryButton: document.querySelector("#retry-button"),
  againButton: document.querySelector("#again-button"),
};

let signedIn = false;
let downloading = false;

function errorMessage(error) {
  const message = error?.message || String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (!button.dataset.label) button.dataset.label = button.textContent.trim();
  button.textContent = busy ? label : button.dataset.label;
}

function updateAuth(status) {
  signedIn = status.signedIn;
  elements.accountName.textContent = status.profile?.email || (signedIn ? "Signed in" : "Not signed in");
  elements.authButton.textContent = signedIn ? "Sign out" : "Sign in";
  elements.scanButton.disabled = !signedIn;
}

elements.authButton.addEventListener("click", async () => {
  elements.message.textContent = "";
  setBusy(elements.authButton, true, signedIn ? "Signing out…" : "Waiting for Google…");
  try {
    updateAuth(signedIn ? await window.driveUtils.signOut() : await window.driveUtils.signIn());
    if (!signedIn) elements.optionsCard.classList.add("hidden");
  } catch (error) {
    elements.message.textContent = errorMessage(error);
  } finally {
    setBusy(elements.authButton, false);
    elements.authButton.textContent = signedIn ? "Sign out" : "Sign in";
  }
});

elements.scanButton.addEventListener("click", async () => {
  elements.message.textContent = "";
  elements.optionsCard.classList.add("hidden");
  setBusy(elements.scanButton, true, "Scanning…");
  try {
    const summary = await window.driveUtils.inspectFolder(elements.folderUrl.value);
    elements.folderName.textContent = summary.name;
    const parts = [`${summary.fileCount} file${summary.fileCount === 1 ? "" : "s"}`, `${summary.folderCount} folder${summary.folderCount === 1 ? "" : "s"}`];
    if (summary.unsupportedCount) parts.push(`${summary.unsupportedCount} Google file${summary.unsupportedCount === 1 ? "" : "s"} skipped`);
    elements.folderStats.textContent = parts.join(" · ");
    elements.message.textContent = "";
    elements.perFolderChoice.classList.toggle("hidden", !summary.hasSubfolders);
    if (!summary.hasSubfolders) document.querySelector('input[value="single-zip"]').checked = true;
    elements.optionsCard.classList.remove("hidden");
  } catch (error) {
    elements.message.textContent = errorMessage(error);
  } finally {
    setBusy(elements.scanButton, false);
  }
});

elements.browseButton.addEventListener("click", async () => {
  const destination = await window.driveUtils.chooseDestination();
  if (destination) {
    elements.destination.value = destination;
    elements.downloadButton.disabled = false;
  }
});

elements.downloadButton.addEventListener("click", async () => {
  downloading = true;
  elements.optionsCard.classList.add("hidden");
  elements.resultCard.classList.add("hidden");
  elements.progressCard.classList.remove("hidden");
  elements.cancelButton.disabled = false;
  elements.progressBar.style.width = "0%";
  elements.progressPercent.textContent = "0%";
  try {
    await window.driveUtils.startDownload({
      folderUrl: elements.folderUrl.value,
      destination: elements.destination.value,
      mode: document.querySelector('input[name="mode"]:checked').value,
    });
  } catch (error) {
    showResult({ failures: [{ label: "Download", message: errorMessage(error) }], completed: [], cancelled: false });
  } finally {
    downloading = false;
  }
});

elements.cancelButton.addEventListener("click", async () => {
  elements.cancelButton.disabled = true;
  elements.progressTitle.textContent = "Cancelling…";
  await window.driveUtils.cancelDownload();
});

elements.retryButton.addEventListener("click", async () => {
  downloading = true;
  elements.resultCard.classList.add("hidden");
  elements.progressCard.classList.remove("hidden");
  elements.cancelButton.disabled = false;
  elements.progressBar.style.width = "0%";
  elements.progressPercent.textContent = "0%";
  try {
    await window.driveUtils.retryDownload();
  } catch (error) {
    showResult({ failures: [{ label: "Retry", message: errorMessage(error) }], completed: [], cancelled: false });
  } finally {
    downloading = false;
  }
});

elements.againButton.addEventListener("click", () => {
  elements.resultCard.classList.add("hidden");
  elements.folderUrl.value = "";
  elements.destination.value = "";
  elements.downloadButton.disabled = true;
  elements.folderUrl.focus();
});

function showResult(progress) {
  elements.progressCard.classList.add("hidden");
  elements.resultCard.classList.remove("hidden");
  elements.failureList.replaceChildren();
  elements.retryButton.classList.toggle("hidden", !progress.failures?.length);
  if (progress.cancelled) {
    elements.resultTitle.textContent = "Download cancelled";
    elements.resultMessage.textContent = progress.completed?.length ? "Completed downloads were kept. The partial file was removed." : "No incomplete files were kept.";
  } else if (progress.failures?.length) {
    elements.resultTitle.textContent = progress.completed?.length ? "Some downloads failed" : "Download failed";
    elements.resultMessage.textContent = progress.completed?.length ? "Completed downloads were kept. You can scan the folder and try again." : "Nothing was completed. Please try again.";
    for (const failure of progress.failures) {
      const item = document.createElement("li");
      item.textContent = `${failure.label}: ${failure.message}`;
      elements.failureList.append(item);
    }
  } else {
    elements.resultTitle.textContent = "Download complete";
    elements.resultMessage.textContent = `${progress.completed?.length || 0} item${progress.completed?.length === 1 ? "" : "s"} saved successfully.`;
  }
}

window.driveUtils.onProgress((progress) => {
  if (progress.phase === "scanning") {
    elements.message.textContent = progress.message;
    return;
  }
  if (["complete", "partial", "cancelled"].includes(progress.phase)) {
    showResult(progress);
    return;
  }
  if (!downloading) return;
  const percent = progress.totalBytes ? Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100)) : 0;
  elements.progressPhase.textContent = `Download ${progress.jobIndex || 1} of ${progress.jobCount || 1}`;
  elements.progressTitle.textContent = progress.item || progress.message || "Preparing…";
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressBar.style.width = `${percent}%`;
  elements.progressDetail.textContent = progress.totalBytes ? `${formatBytes(progress.completedBytes)} of ${formatBytes(progress.totalBytes)}` : "Preparing files…";
});

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

window.driveUtils.getAuthStatus().then(updateAuth).catch((error) => {
  elements.message.textContent = errorMessage(error);
});
