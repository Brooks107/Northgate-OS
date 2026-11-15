const { PermissionFlagsBits } = require("discord.js");

const DEFAULT_WHITELISTED_ROLE_IDS = Object.freeze([
    "1546540563208085616",
    "1548800471227965474",
    "1548591894492094567"
]);

function getWhitelistedRoleIds(savedIds = []) {
    return new Set([...DEFAULT_WHITELISTED_ROLE_IDS, ...savedIds]);
}

async function findAdministratorRolesToRemove(guild, whitelistedRoleIds) {
    await guild.roles.fetch();
    const roleIds = [];
    const skippedRoleIds = [];

    for (const role of guild.roles.cache.values()) {
        if (!role.permissions.has(PermissionFlagsBits.Administrator) || whitelistedRoleIds.has(role.id)) {
            continue;
        }
        if (!role.editable) {
            skippedRoleIds.push(role.id);
            continue;
        }
        roleIds.push(role.id);
    }

    return { roleIds, skippedRoleIds };
}

async function removeAdministratorFromRoles(guild, roleIds, reason) {
    const failedRoleIds = [];
    if (!guild?.roles) return [...roleIds];
    try {
        await guild.roles.fetch();
    } catch (error) {
        console.error("[defcon] could not fetch roles before removing Administrator:", error);
        return [...roleIds];
    }

    for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId);
        if (!role || !role.permissions.has(PermissionFlagsBits.Administrator)) continue;

        try {
            await role.setPermissions(
                role.permissions.remove(PermissionFlagsBits.Administrator),
                reason
            );
        } catch (error) {
            failedRoleIds.push(roleId);
            console.error(`[defcon] failed to remove Administrator from role ${roleId}:`, error);
        }
    }
    return failedRoleIds;
}

async function restoreAdministratorToRoles(guild, roleIds, reason) {
    const failedRoleIds = [];
    const restoredRoleIds = [];
    const existingRoleIds = [];
    if (!guild?.roles) {
        return { failedRoleIds: [...roleIds], restoredRoleIds, existingRoleIds };
    }
    try {
        await guild.roles.fetch();
    } catch (error) {
        console.error("[defcon] could not fetch roles before restoring Administrator:", error);
        return { failedRoleIds: [...roleIds], restoredRoleIds, existingRoleIds };
    }

    for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        existingRoleIds.push(roleId);

        try {
            if (!role.permissions.has(PermissionFlagsBits.Administrator)) {
                await role.setPermissions(
                    role.permissions.add(PermissionFlagsBits.Administrator),
                    reason
                );
                restoredRoleIds.push(roleId);
            }
        } catch (error) {
            failedRoleIds.push(roleId);
            console.error(`[defcon] failed to restore Administrator to role ${roleId}:`, error);
        }
    }
    return { failedRoleIds, restoredRoleIds, existingRoleIds };
}

module.exports = {
    DEFAULT_WHITELISTED_ROLE_IDS,
    findAdministratorRolesToRemove,
    getWhitelistedRoleIds,
    removeAdministratorFromRoles,
    restoreAdministratorToRoles
};
