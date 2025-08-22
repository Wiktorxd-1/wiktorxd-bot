const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pfp')
        .setDescription('Show someone\'s pfp')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('user')
                .setDescription('Target')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('server')
                .setDescription('show server pfp')
                .setRequired(false)
        ),

    async execute(interaction) {
        const userInput = interaction.options.getString('user');
        const showServerPfp = interaction.options.getBoolean('server') || false;

        let user, member, pfpBaseURL, pfpURLToDisplay, username, displayName, userId;

        if (userInput) {
            const mentionMatch = userInput.match(/^<@!?(\d+)>$/);
            if (mentionMatch) {
                userId = mentionMatch[1];
            } else if (/^\d{17,20}$/.test(userInput)) {
                userId = userInput;
            }

            if (userId && interaction.guild) {
                try {
                    member = await interaction.guild.members.fetch(userId);
                    user = member.user;
                } catch {
                    member = null;
                    user = null;
                }
            }

            if (!user && !userId && interaction.guild) {
                const found = interaction.guild.members.cache.find(m =>
                    m.user.tag.toLowerCase() === userInput.toLowerCase() ||
                    m.user.username.toLowerCase() === userInput.toLowerCase()
                );
                if (found) {
                    user = found.user;
                    member = found;
                    userId = user.id;
                }
            }

            if (!user && userId) {
                try {
                    const apiRes = await axios.get(`https://avatar-cyan.vercel.app/api/${encodeURIComponent(userId)}`);
                    const apiData = apiRes.data;
                    user = { id: apiData.id, username: apiData.username };
                    username = apiData.username;
                    displayName = apiData.display_name || apiData.username;
                    pfpBaseURL = apiData.avatarUrl.split('?')[0];
                    pfpURLToDisplay = `${pfpBaseURL}?size=256`;
                } catch {
                    return interaction.reply({ content: `Could not fetch user with ID \`${userId}\`.`, flags: 64 });
                }
            }
        }

        if (!user) {
            user = interaction.user;
            member = interaction.member;
        }

        if (!pfpURLToDisplay) {
            username = user.username;
            displayName = member?.displayName || user.globalName || user.username;
            if (showServerPfp && member && member.avatar) {
                pfpBaseURL = member.displayAvatarURL({ dynamic: true, size: 4096 }).split('?')[0];
                pfpURLToDisplay = `${pfpBaseURL}?size=256`;
            } else if (user.displayAvatarURL) {
                pfpBaseURL = user.displayAvatarURL({ dynamic: true, size: 4096 }).split('?')[0];
                pfpURLToDisplay = `${pfpBaseURL}?size=256`;
            } else {
                pfpBaseURL = null;
                pfpURLToDisplay = null;
            }
        }

        if (!pfpURLToDisplay) {
            return interaction.reply({ content: 'Could not resolve pfp for the given input.', flags: 64 });
        }

        const initialPfpEmbed = new EmbedBuilder()
            .setColor(0xFBE7BD)
            .setTitle(`${displayName || username}'s profile pic`)
            .setImage(pfpURLToDisplay)
            .setTimestamp();

        const showSizesPfpButton = new ButtonBuilder()
            .setCustomId('pfp_show_sizes')
            .setLabel('Show Sizes')
            .setStyle(ButtonStyle.Primary);

        const initialPfpActionRow = new ActionRowBuilder()
            .addComponents(showSizesPfpButton);

        await interaction.reply({
            embeds: [initialPfpEmbed],
            components: [initialPfpActionRow]
        });
        let replyMessage;
        try {
            replyMessage = await interaction.fetchReply();
        } catch (error) {
            console.error('Failed to fetch reply:', error.message);
            return;
        }

        const showSizesPfpCollector = replyMessage.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id && i.customId === 'pfp_show_sizes',
            time: 180000,
            max: 1
        });

        showSizesPfpCollector.on('collect', async pfpButtonInteraction => {
            const sizePfpButtonsRow1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('pfp_size_64').setLabel('64x64').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('pfp_size_128').setLabel('128x128').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('pfp_size_256').setLabel('256x256').setStyle(ButtonStyle.Secondary)
                );

            const sizePfpButtonsRow2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setURL(`${pfpBaseURL}?size=512`).setLabel('512x512').setStyle(ButtonStyle.Link),
                    new ButtonBuilder().setURL(`${pfpBaseURL}?size=1024`).setLabel('1024x1024').setStyle(ButtonStyle.Link),
                    new ButtonBuilder().setURL(`${pfpBaseURL}?size=2048`).setLabel('2048x2048').setStyle(ButtonStyle.Link)
                );

            await pfpButtonInteraction.update({
                embeds: [initialPfpEmbed],
                components: [sizePfpButtonsRow1, sizePfpButtonsRow2]
            });

            const sizeChooserPfpCollector = replyMessage.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId.startsWith('pfp_size_'),
                time: 175000,
            });

            sizeChooserPfpCollector.on('collect', async sizePfpButtonInteraction => {
                const selectedPfpSize = sizePfpButtonInteraction.customId.split('_')[2];
                const newPfpURL = `${pfpBaseURL}?size=${selectedPfpSize}`;

                const updatedPfpEmbed = new EmbedBuilder()
                    .setColor(0xFBE7BD)
                    .setTitle(`${displayName || username}'s profile pic`)
                    .setImage(newPfpURL)
                    .setTimestamp();

                await sizePfpButtonInteraction.update({
                    embeds: [updatedPfpEmbed],
                    components: [sizePfpButtonsRow1, sizePfpButtonsRow2]
                });
            });

            sizeChooserPfpCollector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const pfpMessageToEdit = await interaction.fetchReply();
                    const currentRows = pfpMessageToEdit.components;
                    if (currentRows && currentRows.length > 0) {
                        const disabledPfpRows = currentRows.map(row => {
                            return new ActionRowBuilder().addComponents(
                                row.components.map(button => {
                                    const btn = ButtonBuilder.from(button);
                                    btn.setDisabled(true);
                                    return btn;
                                })
                            );
                        });
                        await interaction.editReply({ components: disabledPfpRows });
                    }
                }
            });
        });

        showSizesPfpCollector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                const expiredButtonRow = new ActionRowBuilder().addComponents(
                    showSizesPfpButton.setDisabled(true)
                );
                const pfpMessageToEdit = await interaction.fetchReply();
                await interaction.editReply({ components: [expiredButtonRow] });
            }
        });
    },
};