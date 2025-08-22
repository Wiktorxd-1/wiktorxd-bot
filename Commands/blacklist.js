const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const serverSettings = require('../Data/server_settings.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Add a string to automod')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('string')
                .setDescription('String to blacklist')
                .setRequired(true)
        ),

    async execute(interaction) {
        const string = interaction.options.getString('string');
        const guild = interaction.guild;

        if (!guild) {
            await interaction.reply({ content: 'This command can only be used in a server breh', ephemeral: true });
            return;
        }

        const ownerId = process.env.BOT_OWNER_ID;
        const settings = serverSettings[guild.id];
        const allowedRoles = settings?.modRoles || [];
        const member = await guild.members.fetch(interaction.user.id);

        const isOwner = interaction.user.id === ownerId;
        const hasAllowedRole = allowedRoles.length > 0 && member.roles.cache.some(r => allowedRoles.includes(r.id));

        if (!isOwner && !hasAllowedRole) {
            await interaction.reply({ content: 'You do not have permission to use this command', ephemeral: true });
            return;
        }


        const rules = await guild.autoModerationRules.fetch();
        let rule = rules.find(r => r.name === 'Blacklist');

        const patterns = [
            string,
            `*${string}*`,
            `${string}*`,
            `*${string}`,
        ];

        if (!rule) {
            rule = await guild.autoModerationRules.create({
                name: 'Blacklist',
                eventType: 1,
                triggerType: 1,
                triggerMetadata: { keywordFilter: patterns },
                actions: [{ type: 1 }], 
                enabled: true,
                reason: 'Created by blacklist command'
            });
        } else {
            const existing = rule.triggerMetadata.keywordFilter || [];
            const newKeywords = Array.from(new Set([...existing, ...patterns]));
            await rule.edit({
                triggerMetadata: { keywordFilter: newKeywords }
            });
        }

        await interaction.reply({
            content: `Added \`${string}\` to automod`
        });
    },
};