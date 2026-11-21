const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function git(cwd, ...args) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    }).trim();
}

test("runtime configs sync both ways without including .env files", { timeout: 30_000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "northgate-git-sync-"));
    const remote = path.join(root, "remote.git");
    const host = path.join(root, "host");
    const computer = path.join(root, "computer");

    try {
        fs.mkdirSync(host);
        git(root, "init", "--bare", "--initial-branch=main", remote);
        fs.copyFileSync(
            path.join(__dirname, "..", "git-sync.js"),
            path.join(host, "git-sync.js")
        );
        fs.writeFileSync(path.join(host, ".gitignore"), ".env\n.env.*\n", "utf8");
        fs.writeFileSync(path.join(host, ".env"), "DISCORD_TOKEN=secret\n", "utf8");
        fs.writeFileSync(path.join(host, "main-config.json"), '{"mainGuildId":"main"}\n', "utf8");
        fs.writeFileSync(path.join(host, "vault-config.json"), '{"serverSync":{}}\n', "utf8");
        git(host, "init", "--initial-branch=main");
        git(host, "config", "user.name", "Git Sync Test");
        git(host, "config", "user.email", "git-sync-test@example.invalid");
        git(
            host,
            "add",
            "-A",
            "--",
            ".",
            ":(exclude,icase,glob)**/.env",
            ":(exclude,icase,glob)**/.env.*"
        );
        assert.equal(git(host, "ls-files", ".env"), "");
        git(host, "commit", "-m", "initial config");
        git(host, "remote", "add", "origin", remote);
        git(host, "push", "--quiet", "-u", "origin", "main");
        git(root, "clone", "--quiet", remote, computer);
        git(computer, "config", "user.name", "Git Sync Test");
        git(computer, "config", "user.email", "git-sync-test@example.invalid");

        fs.writeFileSync(
            path.join(host, "vault-config.json"),
            '{"serverSync":{"mainToVaultChannelIds":{"main":"vault"}}}\n',
            "utf8"
        );
        const syncModule = require(path.join(host, "git-sync.js"));
        const hostSync = await syncModule.startAutoSync({
            intervalSeconds: 5,
            pushIntervalSeconds: 5,
            remote: "origin",
            branch: "main",
            autoInstall: false,
            restartOnUpdate: false
        });
        await new Promise(resolve => setTimeout(resolve, 6500));
        hostSync.stop();

        assert.match(
            git(root, "--git-dir", remote, "show", "refs/heads/main:vault-config.json"),
            /"vault"/
        );
        git(computer, "pull", "--quiet");
        assert.match(
            fs.readFileSync(path.join(computer, "vault-config.json"), "utf8"),
            /"vault"/
        );
        assert.equal(
            git(root, "--git-dir", remote, "ls-tree", "-r", "--name-only", "refs/heads/main")
                .split("\n")
                .some(file => /(^|\/)\.env(?:$|\.)/i.test(file)),
            false
        );

        fs.writeFileSync(
            path.join(computer, "main-config.json"),
            '{"mainGuildId":"updated-main"}\n',
            "utf8"
        );
        git(computer, "add", "main-config.json");
        git(computer, "commit", "-m", "update Main config");
        git(computer, "push", "--quiet");

        const pullSync = await syncModule.startAutoSync({
            intervalSeconds: 5,
            pushIntervalSeconds: 5,
            remote: "origin",
            branch: "main",
            autoInstall: false,
            restartOnUpdate: false
        });
        pullSync.stop();

        assert.match(
            fs.readFileSync(path.join(host, "main-config.json"), "utf8"),
            /updated-main/
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
