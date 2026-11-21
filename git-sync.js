const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoPath = path.resolve(__dirname);
const PROTECTED_CONFIG_FILES = ["main-config.json", "vault-config.json"];

const DEFAULTS = {
    enabled: true,
    intervalSeconds: 30,
    remote: "origin",
    branch: null,
    autoInstall: true,
    restartOnUpdate: true,
    push: true,
    pushIntervalSeconds: 300,
    commitMessage: "chore(sync): runtime state",
    dataFiles: []
};

const MAX_REBASE_STEPS = 50;

function stamp() {
    return `[git-sync ${new Date().toISOString()}]`;
}

function log(...args) {
    console.log(stamp(), ...args);
}

function warn(...args) {
    console.warn(stamp(), ...args);
}

function run(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { cwd: repoPath, timeout: 120000, ...options }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = (stderr || "").trim();
                error.stdout = (stdout || "").trim();
                return reject(error);
            }
            resolve(stdout.trim());
        });
    });
}

const git = (...args) => run("git", args);

async function gitQuiet(...args) {
    try {
        return await git(...args);
    } catch {
        return null;
    }
}

function describeError(err) {
    return err?.stderr || err?.message || String(err);
}

function lines(output) {
    return output ? output.split("\n").map(s => s.trim()).filter(Boolean) : [];
}

async function isGitRepo() {
    try {
        return (await git("rev-parse", "--is-inside-work-tree")) === "true";
    } catch {
        return false;
    }
}

async function resolveBranch(configuredBranch) {
    if (configuredBranch) return configuredBranch;

    const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
    if (branch === "HEAD") {
        throw new Error("repository is in detached HEAD state; set gitSync.branch to sync a specific branch");
    }
    return branch;
}

async function getRemoteSha(remote, branch) {
    const output = await git("ls-remote", "--heads", remote, branch);
    if (!output) {
        throw new Error(`branch "${branch}" does not exist on remote "${remote}"`);
    }
    return output.split(/\s+/)[0];
}

async function isDirty() {
    return lines(await git("status", "--porcelain")).length > 0;
}

async function hasCommit(sha) {
    try {
        await git("cat-file", "-e", `${sha}^{commit}`);
        return true;
    } catch {
        return false;
    }
}

async function isAncestor(maybeAncestor, descendant) {
    try {
        await git("merge-base", "--is-ancestor", maybeAncestor, descendant);
        return true;
    } catch {
        return false;
    }
}

async function conflictedPaths() {
    return lines(await git("diff", "--name-only", "--diff-filter=U"));
}

async function commitLocalChanges(message) {
    await git("add", "-A");

    if (!lines(await git("diff", "--cached", "--name-only")).length) return null;

    const summary = lines(await git("diff", "--cached", "--name-only")).slice(0, 4).join(", ");
    await git("commit", "-m", `${message}: ${summary}`);
    return git("rev-parse", "HEAD");
}

async function stashRuntimeConfigChanges() {
    const changedFiles = lines(await git(
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ...PROTECTED_CONFIG_FILES
    ));
    if (!changedFiles.length) return null;

    const previousStash = await gitQuiet("rev-parse", "--verify", "refs/stash");
    await git(
        "stash",
        "push",
        "--include-untracked",
        "--quiet",
        "--message",
        "git-sync: preserve runtime environment configs",
        "--",
        ...PROTECTED_CONFIG_FILES
    );
    const stashSha = await gitQuiet("rev-parse", "--verify", "refs/stash");
    if (!stashSha || stashSha === previousStash) {
        throw new Error("could not safely preserve changed environment config files");
    }
    return stashSha;
}

async function restoreRuntimeConfigChanges(stashSha) {
    for (const file of PROTECTED_CONFIG_FILES) {
        const filePath = path.join(repoPath, file);
        const hasSavedFile = await gitQuiet("cat-file", "-e", `${stashSha}:${file}`);
        if (hasSavedFile === null) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } else {
            const content = await git("show", `${stashSha}:${file}`);
            fs.writeFileSync(filePath, `${content}\n`, "utf8");
        }
    }

    const stashEntries = lines(await git("stash", "list", "--format=%gd %H"));
    const stashEntry = stashEntries.find(entry => entry.endsWith(` ${stashSha}`));
    if (!stashEntry) {
        warn(`runtime config stash ${stashSha.slice(0, 7)} was restored but could not be located for cleanup.`);
        return;
    }
    await git("stash", "drop", stashEntry.split(" ")[0]);
}

async function rebaseOnto(remote, branch, localTip, dataFiles) {
    const continueEnv = { env: { ...process.env, GIT_EDITOR: "true" } };

    try {
        await git("rebase", `${remote}/${branch}`);
        return;
    } catch (err) {
        if (!(await conflictedPaths()).length) {
            await gitQuiet("rebase", "--abort");
            throw err;
        }
    }

    for (let step = 0; step < MAX_REBASE_STEPS; step++) {
        const conflicts = await conflictedPaths();
        if (!conflicts.length) break;

        const unresolvable = conflicts.filter(file => !dataFiles.includes(file));
        if (unresolvable.length) {
            await gitQuiet("rebase", "--abort");
            throw new Error(`conflicts outside the configured data files: ${unresolvable.join(", ")}`);
        }

        for (const file of conflicts) {
            await git("checkout", localTip, "--", file);
            await git("add", "--", file);
        }
        log(`kept the local copy of ${conflicts.join(", ")} through the rebase.`);

        const staged = lines(await git("diff", "--cached", "--name-only"));

        try {
            if (staged.length) {
                await run("git", ["-c", "core.editor=true", "rebase", "--continue"], continueEnv);
            } else {
                await run("git", ["-c", "core.editor=true", "rebase", "--skip"], continueEnv);
            }
            return;
        } catch (err) {
            if (!(await conflictedPaths()).length) {
                await gitQuiet("rebase", "--abort");
                throw err;
            }
        }
    }

    await gitQuiet("rebase", "--abort");
    throw new Error("gave up resolving rebase conflicts after too many steps");
}

async function installDependencies() {
    log("dependency manifest changed; running npm install...");
    try {
        const output = await run("npm", ["install", "--no-audit", "--no-fund"], { timeout: 600000 });
        log("npm install complete.");
        if (output) log(output.split("\n").slice(-5).join("\n"));
        return true;
    } catch (err) {
        warn("npm install failed; continuing with existing node_modules:", describeError(err));
        return false;
    }
}

function createSyncer(settings, hooks) {
    let inFlight = false;
    let restarting = false;
    let warnedAboutConfigCommit = false;
    let lastPushAt = Date.now();
    const dataFiles = [...new Set([...settings.dataFiles, ...PROTECTED_CONFIG_FILES])];

    return async function attemptSync() {
        if (inFlight || restarting) return;
        inFlight = true;
        let runtimeConfigStash = null;

        try {
            const branch = await resolveBranch(settings.branch);
            const upstream = `${settings.remote}/${branch}`;
            const remoteSha = await getRemoteSha(settings.remote, branch);
            const startSha = await git("rev-parse", "HEAD");

            const dirty = await isDirty();
            const pushDue = Date.now() - lastPushAt >= settings.pushIntervalSeconds * 1000;
            const remoteMoved = remoteSha !== startSha && !(await hasCommit(remoteSha).then(has => has && isAncestor(remoteSha, startSha)));
            if (dirty && (remoteMoved || (settings.push && pushDue))) {
                runtimeConfigStash = await stashRuntimeConfigChanges();
            }
            const dirtyForCommit = await isDirty();
            if (settings.push && pushDue && !dirtyForCommit) {
                lastPushAt = Date.now();
            }

            if (settings.push && dirtyForCommit && (pushDue || remoteMoved)) {
                const committed = await commitLocalChanges(settings.commitMessage);
                if (committed) log(`committed local changes as ${committed.slice(0, 7)}.`);
            }

            const localTip = await git("rev-parse", "HEAD");
            let incomingFiles = [];

            if (!(await hasCommit(remoteSha)) || !(await isAncestor(remoteSha, localTip))) {
                await git("fetch", "--quiet", "--prune", settings.remote, branch);

                if (!(await isAncestor(remoteSha, localTip))) {
                    const mergeBase = await git("merge-base", localTip, upstream);
                    incomingFiles = lines(await git("diff", "--name-only", `${mergeBase}..${upstream}`));

                    log(`pulling ${upstream}: ${localTip.slice(0, 7)} <- ${remoteSha.slice(0, 7)}`);

                    try {
                        await rebaseOnto(settings.remote, branch, localTip, dataFiles);
                    } catch (err) {
                        warn("rebase failed, working tree left untouched:", describeError(err));
                        return;
                    }
                }
            }

            const headSha = await git("rev-parse", "HEAD");

            if (settings.push) {
                const ahead = lines(await git("rev-list", `${upstream}..HEAD`)).length;
                if (ahead) {
                    const committedFiles = lines(await git(
                        "log",
                        "--format=",
                        "--name-only",
                        `${upstream}..HEAD`
                    ));
                    const containsConfigChanges = committedFiles.some(
                        file => PROTECTED_CONFIG_FILES.includes(file)
                    );
                    if (containsConfigChanges) {
                        if (!warnedAboutConfigCommit) {
                            warn("not auto-pushing commits that modify environment config files.");
                            warnedAboutConfigCommit = true;
                        }
                    } else {
                        warnedAboutConfigCommit = false;
                        try {
                            await git("push", settings.remote, `HEAD:${branch}`);
                            lastPushAt = Date.now();
                            log(`pushed ${ahead} commit(s) to ${upstream}.`);
                        } catch (err) {
                            warn("push failed, will retry next tick:", describeError(err));
                        }
                    }
                }
            }

            const codeChanged = incomingFiles.filter(file => !dataFiles.includes(file));
            if (!codeChanged.length) return;

            log(`working tree now at ${headSha.slice(0, 7)}; ${codeChanged.length} code file(s) changed upstream.`);

            if (settings.autoInstall) {
                const manifestChanged = codeChanged.some(
                    file => file === "package.json" || file === "package-lock.json"
                );
                if (manifestChanged) await installDependencies();
            }

            if (!settings.restartOnUpdate) {
                log("restartOnUpdate is disabled; new code applies on next manual restart.");
                return;
            }

            restarting = true;
            log("restarting process to apply updates.");

            if (typeof hooks.onBeforeRestart === "function") {
                try {
                    await hooks.onBeforeRestart();
                } catch (err) {
                    warn("shutdown hook failed:", describeError(err));
                }
            }

            if (runtimeConfigStash) {
                await restoreRuntimeConfigChanges(runtimeConfigStash);
                runtimeConfigStash = null;
            }
            process.exit(0);
        } catch (err) {
            warn("sync failed:", describeError(err));
        } finally {
            if (runtimeConfigStash) {
                try {
                    await restoreRuntimeConfigChanges(runtimeConfigStash);
                } catch (err) {
                    warn(
                        "could not restore runtime config edits; the recovery copy remains in git stash:",
                        describeError(err)
                    );
                }
            }
            inFlight = false;
        }
    };
}

module.exports = {
    startAutoSync: async function (options = {}, hooks = {}) {
        const settings = { ...DEFAULTS, ...options };
        settings.dataFiles = Array.isArray(settings.dataFiles) ? settings.dataFiles : [];

        if (!settings.enabled) {
            log("auto-sync disabled via config.");
            return;
        }

        if (!Number.isFinite(settings.intervalSeconds) || settings.intervalSeconds < 5) {
            throw new Error("gitSync.intervalSeconds must be a number >= 5");
        }

        if (!Number.isFinite(settings.pushIntervalSeconds) || settings.pushIntervalSeconds < settings.intervalSeconds) {
            throw new Error("gitSync.pushIntervalSeconds must be a number >= gitSync.intervalSeconds");
        }

        if (!(await isGitRepo())) {
            warn("not a git repository; auto-sync will not run.");
            return;
        }

        let branchLabel;
        try {
            branchLabel = await resolveBranch(settings.branch);
        } catch (err) {
            warn("auto-sync could not start:", describeError(err));
            return;
        }

        log(
            `watching ${settings.remote}/${branchLabel} every ${settings.intervalSeconds}s ` +
            `(push=${settings.push} every ${settings.pushIntervalSeconds}s, autoInstall=${settings.autoInstall}).`
        );

        const attemptSync = createSyncer(settings, hooks);

        const timer = setInterval(() => { attemptSync(); }, settings.intervalSeconds * 1000);
        timer.unref?.();

        await attemptSync();

        return { syncNow: attemptSync, stop: () => clearInterval(timer) };
    }
};
