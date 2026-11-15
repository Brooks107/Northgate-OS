const state = require("../state");

function getDefconRestriction(level = state.load().defconLevel) {
    if (level === 1 || level === 3) return "developers";
    if (level === 2 || level === 5) return "staff";
    return null;
}

function hasRole(member, configuredRoleIds) {
    const roleIds = Array.isArray(configuredRoleIds)
        ? configuredRoleIds
        : [configuredRoleIds];
    return roleIds.filter(Boolean).some(roleId => member?.roles?.cache?.has(String(roleId)));
}

function hasDeveloperId(userId, config) {
    return (Array.isArray(config.developers) ? config.developers : [])
        .some(id => String(id) === String(userId));
}

function hasOwnershipAccess(member, config) {
    return hasRole(member, config.ownershiprole);
}

function hasDefconCommandAccess(userId, member, config, commandName, level = state.load().defconLevel) {
    const restriction = getDefconRestriction(level);
    if (commandName === "d!secure" && restriction) {
        return hasDeveloperId(userId, config) || hasOwnershipAccess(member, config);
    }
    if (!restriction) return true;

    if (restriction === "developers") {
        return hasDeveloperId(userId, config);
    }

    return hasRole(member, config.staffrole);
}

module.exports = {
    getDefconRestriction,
    hasOwnershipAccess,
    hasDefconCommandAccess
};
