const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const readline = require('readline');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hatches')
        .setDescription('Find secret hatches for someone')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addUserOption(option =>
            option.setName('discord')
                .setDescription('discord user')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('username')
                .setDescription('roblox username')
                .setRequired(false)),

    async execute(interaction) {
        const discordUserOption = interaction.options.getUser('discord');
        const robloxUsernameOption = interaction.options.getString('username');
        const filePath = './Data/secrets.ndjson';

        let discordIdToSearch = discordUserOption ? discordUserOption.id : interaction.user.id;
        let robloxUsername = robloxUsernameOption ? robloxUsernameOption.toLowerCase() : null;

        let foundUsername = null;
        if (fs.existsSync(filePath)) {
            const fileStream = fs.createReadStream(filePath);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.discordUserId === discordIdToSearch && data.hatchedBy) {
                        const match = data.hatchedBy.match(/\(@([a-z0-9_]+)\)/i);
                        if (match && match[1]) {
                            foundUsername = match[1].toLowerCase();
                        } else {
                            foundUsername = data.hatchedBy.split(' ')[0].toLowerCase();
                        }
                        break;
                    }
                } catch {}
            }
            rl.close();
            fileStream.close();
        }



        if (!robloxUsernameOption && foundUsername) {
            robloxUsername = foundUsername;
        }
        if (robloxUsernameOption) {
            discordIdToSearch = null; 
        }

        if (!robloxUsername && robloxUsernameOption) {

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Not found')
                        .setDescription('No one was found in the database. The person may not have been verified when they hatched it, or you typed the wrong username')
                        .setColor(0xFBE7BD),
                ],
            });
            return;
        }

        if (!robloxUsername && interaction.guildId !== '1369439484659236954' && discordUserOption && !robloxUsernameOption) {
            await interaction.reply({
                content: 'Discord function only works if the person is in [the bubbler discord server](<https://discord.gg/4zXsCpqF3m>)!',
                flags: 64
            });
            return;
        } else {
            await interaction.deferReply();
        }

        let searchDiscordId = null;
        let searchRobloxUsername = null;

        if (robloxUsernameOption) {
            searchRobloxUsername = robloxUsernameOption.toLowerCase();
        } else if (discordUserOption) {
            searchDiscordId = discordUserOption.id;
        } else {
            searchDiscordId = interaction.user.id;
        }

        const loadMatchingHatches = async () => {
            const tempMatchingHatches = [];
            const fileStream = fs.createReadStream(filePath);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                if (!line.trim()) continue;

                try {
                    const data = JSON.parse(line);
                    const hatchedByRaw = data.hatchedBy || '';
                    const hatchedByLower = hatchedByRaw.toLowerCase();

                    const matchesDiscord = searchDiscordId && data.discordUserId === searchDiscordId;

                    let matchesRoblox = false;
                    if (searchRobloxUsername) {

                        let extractedRobloxUsername = '';
                        const atUsernameMatch = hatchedByLower.match(/\(@([a-z0-9_]+)\)/);
                        if (atUsernameMatch && atUsernameMatch[1]) {
                            extractedRobloxUsername = atUsernameMatch[1];
                        } else {
                            const firstWordMatch = hatchedByLower.match(/^([a-z0-9_]+)/);
                            if (firstWordMatch && firstWordMatch[1]) {
                                extractedRobloxUsername = firstWordMatch[1];
                            }
                        }
                        if (extractedRobloxUsername === searchRobloxUsername) {
                            matchesRoblox = true;
                        }
                    } else if (searchDiscordId) {

                        if (data.discordUserId === searchDiscordId) {
                            matchesRoblox = true;
                        }
                    }

                    if (matchesDiscord || matchesRoblox) {
                        tempMatchingHatches.push(data);
                    }
                } catch (error) {
                    console.error('Error parsing line during scan:', error);
                }
            }
            rl.close();
            fileStream.close();
            return tempMatchingHatches;
        };

        const matchingHatches = await loadMatchingHatches();
        matchingHatches.reverse();

        if (matchingHatches.length === 0) {
            let notFoundMessage =
                'No one was found in the database. The person may not have been verified when they hatched it, or you typed the wrong username';
            if (searchDiscordId && !robloxUsernameOption) {
                notFoundMessage = 'No hatches found for the discord account';
            } else if (searchRobloxUsername && !discordUserOption) {
                notFoundMessage = `No hatches found for "${robloxUsernameOption}"`;
            }

            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Not found')
                        .setDescription(notFoundMessage)
                        .setColor(0xFBE7BD),
                ],
            });
        }

        let currentIndex = 0;

        const generateEmbed = (idx) => {
            const hatchData = matchingHatches[idx];

            if (!hatchData || typeof hatchData !== 'object') {
                console.error('Invalid hatchData at index:', idx, hatchData);
                return new EmbedBuilder()
                    .setTitle('Error Displaying Data')
                    .setDescription('An unexpected error occurred while preparing this hatch record for display.')
                    .setColor(0xFF0000);
            }

            const unixTimestamp = Math.floor(new Date(hatchData.timestamp).getTime() / 1000);
            return new EmbedBuilder()
                .setTitle(hatchData.name || 'Unknown Pet')
                .setDescription(
                    `<:user:1385619588703846613> **Hatched by:** ${hatchData.hatchedBy || 'Unknown'}\n` +
                    `<:luck:1385619577496535162> **Exist (when hatched):** ${hatchData.totalHatched || 'Unknown'}\n` +
                    `<:paw:1385619568126464010> **Rarity:** ${hatchData.rarity || 'Unknown'}\n` +
                    `<:clock:1385619558991265863> **Time:** <t:${unixTimestamp}:R>\n\n` +
                    `**Secret ${idx + 1}/${matchingHatches.length}**`
                )
                .setThumbnail(hatchData.imageUrl)
                .setColor(0xFBE7BD)
                .setTimestamp();
        };

        const getActionRow = (currentIdx) => {
            if (matchingHatches.length <= 1) {
                return null;
            }

            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('previous_hatch')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentIdx === 0),
                new ButtonBuilder()
                    .setCustomId('next_hatch')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentIdx === matchingHatches.length - 1)
            );
        };

        let currentEmbed = generateEmbed(currentIndex);
        let actionRow = getActionRow(currentIndex);

        const replyOptions = {
            embeds: [currentEmbed],
            components: actionRow ? [actionRow] : [],
        };

        const message = await interaction.editReply(replyOptions);

        if (matchingHatches.length > 1) {
            const collector = message.createMessageComponentCollector({ time: 300000 });

            collector.on('collect', async (i) => {
                if (i.customId === 'previous_hatch') {
                    currentIndex--;
                } else if (i.customId === 'next_hatch') {
                    currentIndex++;
                }

                currentEmbed = generateEmbed(currentIndex);
                actionRow = getActionRow(currentIndex);

                await i.update({
                    embeds: [currentEmbed],
                    components: [actionRow],
                });
            });

            collector.on('end', () => {});
        }
    },
};