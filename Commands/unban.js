const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../Data/logs.json');

function logAction(action) {
    let logs = [];
    try {
        if (fs.existsSync(LOG_FILE)) {
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) || [];
        }
    } catch (e) { logs = []; }
    logs.push(action);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}


function isMod(interaction) {
    if (!interaction.guild) return false;
    if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    try {
        const settingsPath = path.join(__dirname, '../Data/server_settings.json');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        let modRoles = settings[interaction.guildId]?.modRoles || [];
        if (typeof modRoles === "string") modRoles = [modRoles];
        if (!Array.isArray(modRoles)) return false;
        return interaction.member.roles.cache.some(role => modRoles.includes(role.id));
    } catch {
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban someone')
        .setIntegrationTypes([0])
        .addStringOption(option =>
            option.setName('user')
                .setDescription('Who?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        if (interaction.guild && !isMod(interaction)) {
            return interaction.reply({ content: "You need to be an admin or have a moderator role to run this command", flags: 64 });
        }

        const userInput = interaction.options.getString('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        let userId = null;
        if (/^\d+$/.test(userInput)) {
            userId = userInput;
        } else if (userInput.startsWith('<@') && userInput.endsWith('>')) {
            userId = userInput.replace(/[<@!>]/g, '');
        }

        try {
            await interaction.guild.members.unban(userId || userInput, reason);
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Unbanned")
                        .setDescription(`User <@${userId || userInput}> has been unbanned!\nReason: **${reason}**`)
                        .setColor(0xFBE7BD)
                ]
            });

            logAction({
                commandName: 'unban',
                status: 'success',
                user: { id: userId || userInput },
                moderator: { tag: interaction.user.tag, id: interaction.user.id },
                reason,
                guild: interaction.guildId,
                time: new Date().toISOString()
            });


            try {
                const settingsPath = path.join(__dirname, '../Data/server_settings.json');
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                const logChannelId = settings[interaction.guildId]?.logChannel;
                if (logChannelId) {
                    const logChannel = interaction.guild.channels.cache.get(logChannelId);
                    if (logChannel) {
                        logChannel.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle("Unban")
                                    .addFields([
                                        { name: '**User:**', value: `<@${userId || userInput}> (${userId || userInput})`, inline: false },
                                        { name: '**Moderator:**', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                                        { name: '**Reason:**', value: reason, inline: false }
                                    ])
                                    .setColor(0xFBE7BD)
                            ]
                        });
                    }
                }
            } catch (e) {}
        } catch (e) {
            logAction({
                commandName: "unban",
                status: "error",
                error: String(e),
                moderator: { id: interaction.user.id, tag: interaction.user.tag },
                user: userInput,
                guild: interaction.guildId,
                time: new Date().toISOString()
            });
            await interaction.reply({ content: "Bot doesn't have required perms or unknown error :c", flags: 64 });
        }
    }
};

