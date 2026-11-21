const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const MAIN_CONFIG_PATH = path.join(ROOT, "main-config.json");
const VAULT_CONFIG_PATH = path.join(ROOT, "vault-config.json");
const MODE_PATH = path.join(ROOT, "failover-state.json");
const CONFIG_PATHS = {
    main: MAIN_CONFIG_PATH,
    vault: VAULT_CONFIG_PATH
};

let activeEnvironment = null;
let operationalMode = null;
let mainConfigReset = false;

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Could not read ${label} at ${filePath}: ${error.message}`);
    }
}

function writeJsonAtomically(filePath, value, label) {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        try {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        } catch (cleanupError) {
            console.error(`[config-manager] could not remove temporary ${label}:`, cleanupError.message);
        }
        throw new Error(`Could not write ${label} at ${filePath}: ${error.message}`);
    }
}

function mergeMissing(template, current) {
    if (!template || typeof template !== "object" || Array.isArray(template)) {
        return current === undefined ? template : current;
    }

    const merged = current && typeof current === "object" && !Array.isArray(current)
        ? { ...current }
        : {};
    for (const [key, value] of Object.entries(template)) {
        merged[key] = Object.prototype.hasOwnProperty.call(merged, key)
            ? mergeMissing(value, merged[key])
            : value;
    }
    return merged;
}

function getServerIds() {
    let storedServerIds = {};
    if (fs.existsSync(MODE_PATH)) {
        const mode = readJson(MODE_PATH, "failover state");
        storedServerIds = mode.serverIds || {};
    }

    const mainConfig = fs.existsSync(MAIN_CONFIG_PATH)
        ? readJson(MAIN_CONFIG_PATH, "main config")
        : {};
    const vaultConfig = fs.existsSync(VAULT_CONFIG_PATH)
        ? readJson(VAULT_CONFIG_PATH, "vault config")
        : {};
    const mainGuildId = process.env.MAIN_GUILD_ID
        || storedServerIds.main
        || mainConfig.mainGuildId
        || vaultConfig.mainGuildId
        || process.env.GUILD_ID;
    const vaultGuildId = process.env.VAULT_GUILD_ID
        || storedServerIds.vault
        || mainConfig.vaultGuildId
        || vaultConfig.vaultGuildId;

    if (!/^\d{17,20}$/.test(mainGuildId || "")) {
        throw new Error("Set mainGuildId in main-config.json or MAIN_GUILD_ID in the environment.");
    }
    if (!/^\d{17,20}$/.test(vaultGuildId || "")) {
        throw new Error("Set vaultGuildId in main-config.json or VAULT_GUILD_ID in the environment.");
    }
    if (mainGuildId === vaultGuildId) {
        throw new Error("mainGuildId and vaultGuildId must refer to different servers.");
    }
    return { main: mainGuildId, vault: vaultGuildId };
}

function findMainBackupChannelId() {
    const mainConfig = fs.existsSync(MAIN_CONFIG_PATH)
        ? readJson(MAIN_CONFIG_PATH, "main config")
        : {};
    const vaultConfig = fs.existsSync(VAULT_CONFIG_PATH)
        ? readJson(VAULT_CONFIG_PATH, "vault config")
        : {};
    const mode = fs.existsSync(MODE_PATH)
        ? readJson(MODE_PATH, "failover state")
        : {};
    const vaultBackupChannelId = vaultConfig.defconBackupChannelId;
    const mappedMainBackupChannelId = Object.entries(
        vaultConfig.serverSync?.mainToVaultChannelIds || {}
    ).find(([, vaultChannelId]) => String(vaultChannelId) === String(vaultBackupChannelId))?.[0];
    const candidates = [
        process.env.MAIN_BACKUP_CHANNEL_ID,
        mainConfig.defconBackupChannelId,
        mode.mainBackupChannelId,
        mappedMainBackupChannelId
    ];
    const candidate = candidates.find(value => /^\d{17,20}$/.test(String(value || "")));
    return candidate ? String(candidate) : null;
}

function getMainBackupChannelId() {
    const channelId = findMainBackupChannelId();
    if (!channelId) {
        throw new Error(
            "Set defconBackupChannelId in main-config.json or MAIN_BACKUP_CHANNEL_ID in the environment."
        );
    }
    return channelId;
}

function readMode() {
    if (activeEnvironment) return;
    try {
        const stored = JSON.parse(fs.readFileSync(MODE_PATH, "utf8"));
        if (!Object.prototype.hasOwnProperty.call(CONFIG_PATHS, stored.activeEnvironment)) {
            throw new Error("activeEnvironment must be 'main' or 'vault'");
        }
        if (!["main", "vault-test", "vault-production"].includes(stored.operationalMode)) {
            throw new Error("operationalMode is invalid");
        }
        activeEnvironment = stored.activeEnvironment;
        operationalMode = stored.operationalMode;
        mainConfigReset = stored.mainConfigReset === true;
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw new Error(`Could not load failover state at ${MODE_PATH}: ${error.message}`);
        }
        activeEnvironment = "main";
        operationalMode = "main";
    }
}

function initialize() {
    readMode();
    if (!fs.existsSync(MAIN_CONFIG_PATH)) {
        throw new Error(`Missing main config at ${MAIN_CONFIG_PATH}. Create main-config.json before starting the bot.`);
    }

    const ids = getServerIds();
    const mainConfig = readJson(MAIN_CONFIG_PATH, "main config");

    if (!fs.existsSync(VAULT_CONFIG_PATH)) {
        if (mainConfigReset) {
            throw new Error(`Cannot create vault config from a blank Main config; restore ${MAIN_CONFIG_PATH} or provide ${VAULT_CONFIG_PATH}.`);
        }
        writeJsonAtomically(VAULT_CONFIG_PATH, {
            ...mainConfig,
            guildId: ids.vault,
            mainGuildId: ids.main,
            vaultGuildId: ids.vault
        }, "vault config");
        console.log("[config-manager] created vault-config.json from main-config.json.");
    }

    if (!mainConfigReset) {
        const completedMainConfig = {
            ...mainConfig,
            guildId: ids.main,
            mainGuildId: ids.main,
            vaultGuildId: ids.vault
        };
        if (JSON.stringify(completedMainConfig) !== JSON.stringify(mainConfig)) {
            writeJsonAtomically(MAIN_CONFIG_PATH, completedMainConfig, "main config");
        }

        const existingVaultConfig = readJson(VAULT_CONFIG_PATH, "vault config");
        const completedVaultConfig = mergeMissing(mainConfig, existingVaultConfig);
        completedVaultConfig.guildId = ids.vault;
        completedVaultConfig.mainGuildId = ids.main;
        completedVaultConfig.vaultGuildId = ids.vault;
        if (JSON.stringify(completedVaultConfig) !== JSON.stringify(existingVaultConfig)) {
            writeJsonAtomically(VAULT_CONFIG_PATH, completedVaultConfig, "vault config");
        }
    }
}

function getActiveEnvironment() {
    readMode();
    return activeEnvironment;
}

function getOperationalMode() {
    readMode();
    return operationalMode;
}

function isVaultMode() {
    return getActiveEnvironment() === "vault";
}

function getMainGuildId() {
    return getServerIds().main;
}

function getVaultGuildId() {
    return getServerIds().vault;
}

function getGuildId(environment = getActiveEnvironment()) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG_PATHS, environment)) {
        throw new Error(`Unknown config environment: ${environment}`);
    }
    return getServerIds()[environment];
}

function getActiveConfigPath() {
    initialize();
    return CONFIG_PATHS[activeEnvironment];
}

function loadConfig() {
    const filePath = getActiveConfigPath();
    const config = readJson(filePath, `${activeEnvironment} config`);
    config.guildId = getGuildId(activeEnvironment);
    config.mainGuildId = getMainGuildId();
    config.vaultGuildId = getVaultGuildId();
    config.operationalMode = getOperationalMode();
    config.isVaultProductionMode =
        activeEnvironment === "vault" && operationalMode === "vault-production";
    return config;
}

function setActiveEnvironment(environment, mode = environment) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG_PATHS, environment)) {
        throw new Error(`Unknown config environment: ${environment}`);
    }
    if (!["main", "vault-test", "vault-production"].includes(mode)) {
        throw new Error(`Unknown operational mode: ${mode}`);
    }

    const mainBackupChannelId = findMainBackupChannelId();
    writeJsonAtomically(MODE_PATH, {
        activeEnvironment: environment,
        operationalMode: mode,
        mainConfigReset,
        serverIds: getServerIds(),
        ...(mainBackupChannelId ? { mainBackupChannelId } : {}),
        changedAt: new Date().toISOString()
    }, "failover state");
    activeEnvironment = environment;
    operationalMode = mode;
}

function blankValue(value) {
    if (Array.isArray(value)) return [];
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).map(key => [key, blankValue(value[key])]));
    }
    if (typeof value === "string") return "";
    if (typeof value === "number") return 0;
    if (typeof value === "boolean") return false;
    return null;
}

function resetMainConfig() {
    initialize();
    const mainBackupChannelId = findMainBackupChannelId();
    mainConfigReset = true;
    writeJsonAtomically(MODE_PATH, {
        activeEnvironment,
        operationalMode,
        mainConfigReset,
        serverIds: getServerIds(),
        ...(mainBackupChannelId ? { mainBackupChannelId } : {}),
        changedAt: new Date().toISOString()
    }, "failover state");
    const blankConfig = blankValue(readJson(MAIN_CONFIG_PATH, "main config"));
    writeJsonAtomically(MAIN_CONFIG_PATH, blankConfig, "main config");
}

function setPathValue(config, configKey, values) {
    const parts = configKey.split(".");
    let target = config;
    for (const part of parts.slice(0, -1)) {
        if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) {
            target[part] = {};
        }
        target = target[part];
    }
    target[parts[parts.length - 1]] = values;
}

function saveGroupConfig(configKey, values) {
    if (typeof configKey !== "string" || !configKey.trim()) {
        throw new TypeError("configKey must be a non-empty string.");
    }
    if (!Array.isArray(values)) {
        throw new TypeError("Group config values must be an array.");
    }

    const filePath = getActiveConfigPath();
    const config = readJson(filePath, `${activeEnvironment} config`);
    setPathValue(config, configKey, values);
    writeJsonAtomically(filePath, config, `${activeEnvironment} config`);
}

function reverseMapping(mapping) {
    return new Map([...mapping].map(([sourceId, targetId]) => [targetId, sourceId]));
}

function mapConfiguredId(id, currentMap, previousMap, previousTargetToSource) {
    if (currentMap.has(id)) return currentMap.get(id);
    if (previousMap.has(id)) return "";
    const previousSourceId = previousTargetToSource.get(id);
    if (previousSourceId) return currentMap.get(previousSourceId) || "";
    return id;
}

function replaceConfiguredIds(
    value,
    roleMap,
    channelMap,
    previousRoleMap = new Map(),
    previousChannelMap = new Map()
) {
    const previousRoleTargets = reverseMapping(previousRoleMap);
    const previousChannelTargets = reverseMapping(previousChannelMap);
    if (typeof value === "string") {
        const roleId = mapConfiguredId(
            value,
            roleMap,
            previousRoleMap,
            previousRoleTargets
        );
        if (roleId !== value) return roleId;
        return mapConfiguredId(
            value,
            channelMap,
            previousChannelMap,
            previousChannelTargets
        );
    }
    if (Array.isArray(value)) {
        return value
            .map(item => replaceConfiguredIds(
                item,
                roleMap,
                channelMap,
                previousRoleMap,
                previousChannelMap
            ))
            .filter(item => item !== "");
    }
    if (value && typeof value === "object") {
        for (const [key, nestedValue] of Object.entries(value)) {
            value[key] = replaceConfiguredIds(
                nestedValue,
                roleMap,
                channelMap,
                previousRoleMap,
                previousChannelMap
            );
        }
    }
    return value;
}

function updateVaultConfigIds(roleMap, channelMap, runtimeConfig, syncedAt = new Date().toISOString()) {
    if (!(roleMap instanceof Map) || !(channelMap instanceof Map)) {
        throw new TypeError("Role and channel ID mappings must be Maps.");
    }
    initialize();
    const vaultConfig = readJson(VAULT_CONFIG_PATH, "vault config");
    const previousRoleMap = new Map(
        Object.entries(vaultConfig.serverSync?.mainToVaultRoleIds || {})
    );
    const previousChannelMap = new Map(
        Object.entries(vaultConfig.serverSync?.mainToVaultChannelIds || {})
    );
    replaceConfiguredIds(
        vaultConfig,
        roleMap,
        channelMap,
        previousRoleMap,
        previousChannelMap
    );
    vaultConfig.guildId = getVaultGuildId();
    vaultConfig.mainGuildId = getMainGuildId();
    vaultConfig.vaultGuildId = getVaultGuildId();
    vaultConfig.serverSync = {
        lastSynchronizedAt: syncedAt,
        mainToVaultRoleIds: Object.fromEntries(roleMap),
        mainToVaultChannelIds: Object.fromEntries(channelMap)
    };
    writeJsonAtomically(VAULT_CONFIG_PATH, vaultConfig, "vault config");

    if (getActiveEnvironment() === "vault" && runtimeConfig) {
        replaceConfiguredIds(
            runtimeConfig,
            roleMap,
            channelMap,
            previousRoleMap,
            previousChannelMap
        );
        runtimeConfig.serverSync = vaultConfig.serverSync;
    }
}

module.exports = {
    CONFIG_PATHS,
    getActiveConfigPath,
    getActiveEnvironment,
    getOperationalMode,
    getMainGuildId,
    getMainBackupChannelId,
    getVaultGuildId,
    getGuildId,
    isVaultMode,
    loadConfig,
    setActiveEnvironment,
    resetMainConfig,
    saveGroupConfig,
    blankValue,
    mergeMissing,
    replaceConfiguredIds,
    updateVaultConfigIds
};
