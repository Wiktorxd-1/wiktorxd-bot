const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../Data/logs.json');

function logDmAction(action) {
    let logs = [];
    try {
        if (fs.existsSync(LOG_FILE)) {
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) || [];
        }
    } catch (e) {
        logs = [];
    }
    logs.push(action);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

function getUserFromInput(client, inputValue) {
    inputValue = inputValue.trim();
    if (/^\d+$/.test(inputValue)) {
        return client.users.fetch(inputValue).catch(() => null);
    }
    if (inputValue.startsWith('<@') && inputValue.endsWith('>')) {
        const userId = inputValue.replace(/[<@!>]/g, '');
        return client.users.fetch(userId).catch(() => null);
    }

    for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.find(
            m => m.user.username === inputValue || m.displayName === inputValue
        );
        if (member) return Promise.resolve(member.user);
    }
    return Promise.resolve(null);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('DM someone using the bot')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('user')
                .setDescription('Who?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message to send')
                .setRequired(true))
        .setDMPermission(true),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: 64 });

        const userInput = interaction.options.getString('user');
        const message = interaction.options.getString('message');

        let targetUser = await getUserFromInput(client, userInput);

        if (!targetUser) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Error")
                        .setDescription("Can't find the person, either you messed up or I did, idk. (GET OU-)")
                        .setColor(0xFF0000)
                ]
            });
            logDmAction({
                commandName: "dm",
                status: "error",
                by: { id: interaction.user.id, tag: interaction.user.tag },
                to: userInput,
                message,
                error: "User not found",
                time: new Date().toISOString()
            });
            return;
        }

        try {
            const sentMessage = await targetUser.send(`${message}\n-# Sent by ${interaction.user.tag}`);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Success!!")
                        .setDescription(`Message sent to ${targetUser.tag}`)
                        .setColor(0xFBE7BD)
                ]
            });
            logDmAction({
                commandName: 'dm',
                status: 'success',
                by: { id: interaction.user.id, tag: interaction.user.tag },
                to: { id: targetUser.id, tag: targetUser.tag },
                message,
                sentMessageId: sentMessage.id,
                time: new Date().toISOString()
            });
        } catch (e) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Error")
                        .setDescription(`Failed to send the message; this often happens when the bot __isn't in the same server as the target__! : ${String(e)}`)
                        .setColor(0xFF0000)
                ]
            });
            logDmAction({
                commandName: "dm",
                status: "error",
                by: { id: interaction.user.id, tag: interaction.user.tag },
                to: { id: targetUser.id, tag: targetUser.tag },
                message,
                error: String(e),
                time: new Date().toISOString()
            });
        }
    }
};