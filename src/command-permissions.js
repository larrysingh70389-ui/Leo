import { PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';

export function isAdministrator(interaction) {
  return Boolean(interaction.guild && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export function isAuthorizedUser(interaction) {
  return config.authorizedUserIds.includes(interaction.user?.id);
}

export function hasTicketStaffRole(interaction) {
  const roles = interaction.member?.roles;
  return config.ticketSupportRoleIds.some((roleId) => roles?.cache?.has(roleId));
}
