const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
    createMainServerBackup,
    getNextRunAt
} = require("../utils/nightly-backup");

test("nightly backups use Main's guild and configured storage channel", async () => {
    const mainGuild = { id: "main-guild" };
    const vaultGuild = { id: "vault-guild" };
    const client = {
        guilds: {
            cache: new Map([
                [mainGuild.id, mainGuild],
                [vaultGuild.id, vaultGuild]
            ]),
            fetch: async () => {
                throw new Error("The cached Main guild should be used.");
            }
        }
    };
    let backupArguments;
    const receipt = { backupId: "1" };

    const result = await createMainServerBackup(
        client,
        {
            getMainGuildId: () => mainGuild.id,
            getMainBackupChannelId: () => "main-backup-channel"
        },
        async (...args) => {
            backupArguments = args;
            return receipt;
        }
    );

    assert.equal(result, receipt);
    assert.deepEqual(backupArguments, [mainGuild, client, "main-backup-channel"]);
});

test("production Main config reset preserves its nightly backup destination", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "northgate-config-test-"));
    const modulePath = path.join(root, "configManager.js");
    const envNames = [
        "MAIN_GUILD_ID",
        "VAULT_GUILD_ID",
        "GUILD_ID",
        "MAIN_BACKUP_CHANNEL_ID"
    ];
    const savedEnvironment = new Map(envNames.map(name => [name, process.env[name]]));
    for (const name of envNames) delete process.env[name];

    t.after(() => {
        for (const [name, value] of savedEnvironment) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        if (fs.existsSync(modulePath)) {
            delete require.cache[require.resolve(modulePath)];
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    fs.copyFileSync(path.join(__dirname, "..", "configManager.js"), modulePath);
    fs.writeFileSync(path.join(root, "main-config.json"), JSON.stringify({
        guildId: "11111111111111111",
        mainGuildId: "11111111111111111",
        vaultGuildId: "22222222222222222",
        defconBackupChannelId: "33333333333333333"
    }));
    fs.writeFileSync(path.join(root, "vault-config.json"), JSON.stringify({
        guildId: "22222222222222222",
        mainGuildId: "11111111111111111",
        vaultGuildId: "22222222222222222"
    }));

    const manager = require(modulePath);
    manager.setActiveEnvironment("vault", "vault-production");
    manager.resetMainConfig();

    const failoverState = JSON.parse(fs.readFileSync(path.join(root, "failover-state.json"), "utf8"));
    const blankMainConfig = JSON.parse(fs.readFileSync(path.join(root, "main-config.json"), "utf8"));
    assert.equal(failoverState.mainBackupChannelId, "33333333333333333");
    assert.equal(blankMainConfig.defconBackupChannelId, "");
    assert.equal(manager.getMainBackupChannelId(), "33333333333333333");
});

test("nightly backup scheduler targets the next UTC midnight", () => {
    const nextRun = getNextRunAt(new Date("2026-03-08T23:59:59.000Z"));

    assert.equal(nextRun.toISOString(), "2026-03-09T00:00:00.000Z");
});

test("nightly backup scheduler advances across year boundaries", () => {
    const nextRun = getNextRunAt(new Date("2026-12-31T23:00:00.000Z"));

    assert.equal(nextRun.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("nightly backup scheduler rejects invalid dates", () => {
    assert.throws(() => getNextRunAt(new Date("invalid")), /valid Date/);
});
