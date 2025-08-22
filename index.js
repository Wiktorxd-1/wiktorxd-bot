const { Client, IntentsBitField, ActivityType, Collection, REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const { startUptimeUpdater } = require('./Utility/uptime');
const startDevMsgWatcher = require('./Utility/dev_msgs.js');
const startSecretsWatcher = require('./Utility/secrets.js');
require('./Utility/deploy-commands.js');
const startOnMember = require('./Utility/on_member');
const startUpdatesMonitor = require('./Utility/updates.js');
const { startHatchesApi } = require('./Utility/hatches_api.js');


const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildModeration,
        IntentsBitField.Flags.GuildEmojisAndStickers,
        IntentsBitField.Flags.GuildIntegrations,
        IntentsBitField.Flags.GuildWebhooks,
        IntentsBitField.Flags.GuildInvites,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.GuildPresences,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildMessageTyping,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.DirectMessageReactions,
        IntentsBitField.Flags.DirectMessageTyping,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildScheduledEvents,
        IntentsBitField.Flags.AutoModerationConfiguration,
        IntentsBitField.Flags.AutoModerationExecution
    ]
});

client.commands = new Collection();
client.prefixCommands = new Collection();

let remindmeCommandModule = null;

const PREFIX = process.env.PREFIX || '?';

let startTime;

client.once('ready', async () => {
    const path = require('path');
    const commandsPath = path.join(__dirname, 'Commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            if (command.data.name === 'remindme') {
                remindmeCommandModule = command;
            }
        } else {
            console.warn(`The command at ${filePath} is missing a required "data" or "execute" property for Slash Commands.`);
        }

        if (command.prefixData && command.prefixData.name && command.prefixData.execute) {
            client.prefixCommands.set(command.prefixData.name, command.prefixData);
        }
    }

    console.log(`Logged in as ${client.user.tag}!`);
    startTime = Date.now();
    startUptimeUpdater(client, () => startTime);

    if (remindmeCommandModule && remindmeCommandModule.startChecker) {
        await remindmeCommandModule.startChecker(client);
    } else {
        console.warn('remindme command module or its startChecker function not found. Reminders will not function.');
    }

    startDevMsgWatcher(client);
    startSecretsWatcher(client);

    startUpdatesMonitor(client);
    startOnMember(client);
    startHatchesApi();
});

client.on('error', error => {
    console.error('A client error has occurred:', error);
});

client.on('warn', info => {
    console.warn('A client warning has occurred:', info);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error executing this command!', flags: 64 });
        } else {
            await interaction.reply({ content: 'There was an error executing this command!', flags: 64  });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.prefixCommands.get(commandName);

    if (!command) return;

    try {
        await command.execute(message, args, client);
    } catch (error) {
        console.error('Prefix command error:', error);
        message.reply('There was an error executing this prefix command!');
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
});



client.login(process.env.DISCORD_TOKEN);