require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

function loadLogs() {
    const LOG_FILE = path.join(__dirname, '../Data/logs.json');
    try {
        if (fs.existsSync(LOG_FILE)) {
            return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) || [];
        }
    } catch (e) {}
    return [];
}

function getAllCommandNames() {
    const logs = loadLogs();
    const commandNames = new Set();
    for (const log of logs) {
        if (log.commandName) commandNames.add(log.commandName);
    }
    return Array.from(commandNames);
}

function formatLogEntry(entry, index) {
    const fields = [];
    if (entry.commandName) {
        fields.push({ name: `#${index + 1} | Command:`, value: `\`${entry.commandName}\``, inline: false });
    }
    if (entry.status) {
        fields.push({ name: 'Status:', value: `\`${entry.status}\``, inline: false });
    }
    if (entry.by) {
        fields.push({ name: 'Used by:', value: `<@${entry.by.id}> (ID: ${entry.by.id})`, inline: false });
    }
    if (entry.message) {
        fields.push({ name: 'Message:', value: entry.message.length > 1024 ? entry.message.slice(0, 1021) + '...' : entry.message, inline: false });
    }
    if (entry.to) {
        fields.push({ name: 'To:', value: `<@${entry.to.id}> (ID: ${entry.to.id})`, inline: false });
    }
    if (entry.channel) {
        fields.push({ name: 'Channel:', value: `<#${entry.channel.id}> (${entry.channel.name || entry.channel.id})`, inline: false });
    }
    if (entry.user) {
        fields.push({ name: 'User:', value: entry.user.tag ? `${entry.user.tag} (<@${entry.user.id}>)` : `<@${entry.user.id}>`, inline: false });
    }
    if (entry.moderator) {
        fields.push({ name: 'Moderator:', value: entry.moderator.tag ? `${entry.moderator.tag} (<@${entry.moderator.id}>)` : `<@${entry.moderator.id}>`, inline: false });
    }
    if (entry.reason) {
        fields.push({ name: 'Reason:', value: entry.reason, inline: false });
    }
    if (entry.duration) {
        fields.push({ name: 'Duration:', value: entry.duration, inline: false });
    }
    if (entry.error) {
        fields.push({ name: 'Error:', value: entry.error.length > 1024 ? entry.error.slice(0, 1021) + '...' : entry.error, inline: false });
    }
    if (entry.time) {
        const timestamp = Math.floor(new Date(entry.time).getTime() / 1000);
        fields.push({ name: 'Time:', value: `<t:${timestamp}:F>`, inline: false });
    }
    return fields;
}

function getEmbedCharacterCount(embed) {
    let count = 0;
    if (embed.title) count += embed.title.length;
    if (embed.description) count += embed.description.length;
    if (embed.fields) {
        for (const field of embed.fields) {
            count += field.name.length;
            count += field.value.length;
        }
    }
    return count;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Show logz')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option => {
            const commandNames = getAllCommandNames();
            option.setName('command')
                .setDescription('What command?')
                .setRequired(false);
            commandNames.forEach(name => {
                option.addChoices({ name: name, value: name });
            });
            return option;
        }),

    async execute(interaction) {
        if (interaction.user.id !== process.env.BOT_OWNER_ID) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: 64
            });
        }

        const commandFilter = interaction.options.getString('command');
        const logs = loadLogs();

        const filteredLogs = commandFilter
            ? logs.filter(log => log.commandName && log.commandName.toLowerCase() === commandFilter.toLowerCase())
            : logs;

        if (!filteredLogs.length) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Logs")
                        .setDescription(commandFilter ? `No logs found for command: \`${commandFilter}\`` : "No logs found.")
                        .setColor(0xFBE7BD)
                ]
            });
        }

        function paginateLogs(logsToPaginate) {
            const MAX_EMBED_CHARS = 2000;
            const pages = [];
            let currentPageEmbed = new EmbedBuilder()
                .setTitle("Logs")
                .setColor(0xFBE7BD);

            let currentEmbedCharCount = 0;
            let fieldCount = 0;

            for (let i = 0; i < logsToPaginate.length; i++) {
                const entry = logsToPaginate[i];
                const fields = formatLogEntry(entry, i);

                let fieldsCharCount = fields.reduce((acc, field) => acc + field.name.length + field.value.length, 0);

                if (currentEmbedCharCount + fieldsCharCount > MAX_EMBED_CHARS || fieldCount + fields.length > 25) {
                    pages.push(currentPageEmbed);
                    currentPageEmbed = new EmbedBuilder()
                        .setTitle("Logs")
                        .setColor(0xFBE7BD);
                    currentEmbedCharCount = 0;
                    fieldCount = 0;
                }

                for (const field of fields) {
                    currentPageEmbed.addFields(field);
                    currentEmbedCharCount += field.name.length + field.value.length;
                    fieldCount++;
                }
            }
            pages.push(currentPageEmbed);
            return pages;
        }

        const pages = paginateLogs(filteredLogs);
        let currentPageIndex = 0;

        function getComponents(index, totalPages) {
            const row = new ActionRowBuilder();
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('previous_log_page')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(index === 0),
                new ButtonBuilder()
                    .setCustomId('next_log_page')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(index === totalPages - 1),
            );
            return totalPages > 1 ? [row] : [];
        }

        const replyOptions = {
            embeds: [pages[currentPageIndex].setFooter({ text: `Page ${currentPageIndex + 1}/${pages.length}` })],
            components: getComponents(currentPageIndex, pages.length),
            fetchReply: true
        };

        const message = await interaction.reply(replyOptions);

        if (pages.length > 1) {
            const BUTTON_TIMEOUT = 5 * 60 * 1000;
            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: BUTTON_TIMEOUT
            });

            collector.on('collect', async i => {
                if (i.customId === 'previous_log_page') {
                    currentPageIndex--;
                } else if (i.customId === 'next_log_page') {
                    currentPageIndex++;
                }

                await i.update({
                    embeds: [pages[currentPageIndex].setFooter({ text: `Page ${currentPageIndex + 1}/${pages.length}` })],
                    components: getComponents(currentPageIndex, pages.length)
                });
            });

            collector.on('end', async () => {
                const disabledComponents = getComponents(currentPageIndex, pages.length).map(row => {
                    row.components.forEach(button => button.setDisabled(true));
                    return row;
                });
                try {
                    await message.edit({ components: disabledComponents });
                } catch (err) {
                }
            });
        }
    }
};