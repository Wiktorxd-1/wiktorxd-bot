const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Show someone\'s avatar')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('user')
        .setDescription('Target')
        .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('server')
                .setDescription('show server avatar')
                .setRequired(false)
        ),

    async execute(interaction) {
        const userInput = interaction.options.getString('user');
        const showServerAvatar = interaction.options.getBoolean('server') || false;

        let user, member, avatarBaseURL, avatarURLToDisplay, username, displayName, userId;

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
                    avatarBaseURL = apiData.avatarUrl.split('?')[0];
                    avatarURLToDisplay = `${avatarBaseURL}?size=256`;
                } catch {
                    return interaction.reply({ content: `Could not fetch user with ID \`${userId}\`.`, flags: 64 });
                }
            }
        }

        if (!user) {
            user = interaction.user;
            member = interaction.member;
        }

        if (!avatarURLToDisplay) {
            username = user.username;
            displayName = member?.displayName || user.globalName || user.username;
            if (showServerAvatar && member && member.avatar) {
                avatarBaseURL = member.displayAvatarURL({ dynamic: true, size: 4096 }).split('?')[0];
                avatarURLToDisplay = `${avatarBaseURL}?size=256`;
            } else if (user.displayAvatarURL) {
                avatarBaseURL = user.displayAvatarURL({ dynamic: true, size: 4096 }).split('?')[0];
                avatarURLToDisplay = `${avatarBaseURL}?size=256`;
            } else {
                avatarBaseURL = null;
                avatarURLToDisplay = null;
            }
        }

        if (!avatarURLToDisplay) {
            return interaction.reply({ content: 'Could not find avatar for the user', flags: 64});
        }

        const initialEmbed = new EmbedBuilder()
            .setColor(0xFBE7BD)
            .setTitle(`${displayName || username}'s avatar`)
            .setImage(avatarURLToDisplay)
            .setTimestamp();

        const showSizesButton = new ButtonBuilder()
            .setCustomId('avatar_show_sizes')
            .setLabel('Show Sizes')
            .setStyle(ButtonStyle.Primary);

        const initialActionRow = new ActionRowBuilder()
            .addComponents(showSizesButton);

        await interaction.reply({
            embeds: [initialEmbed],
            components: [initialActionRow]
        });
        let replyMessage;
        try {
            replyMessage = await interaction.fetchReply();
        } catch (error) {
            console.error('Failed to fetch reply:', error.message);
            return;
        }

        const showSizesCollector = replyMessage.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id && i.customId === 'avatar_show_sizes',
            time: 180000,
            max: 1
        });

        showSizesCollector.on('collect', async buttonInteraction => {
            const sizeButtonsRow1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('avatar_size_64').setLabel('64x64').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('avatar_size_128').setLabel('128x128').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('avatar_size_256').setLabel('256x256').setStyle(ButtonStyle.Secondary)
                );

            const sizeButtonsRow2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setURL(`${avatarBaseURL}?size=512`).setLabel('512x512').setStyle(ButtonStyle.Link),
                    new ButtonBuilder().setURL(`${avatarBaseURL}?size=1024`).setLabel('1024x1024').setStyle(ButtonStyle.Link),
                    new ButtonBuilder().setURL(`${avatarBaseURL}?size=2048`).setLabel('2048x2048').setStyle(ButtonStyle.Link)
                );

            await buttonInteraction.update({
                embeds: [initialEmbed],
                components: [sizeButtonsRow1, sizeButtonsRow2]
            });

            const sizeChooserCollector = replyMessage.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId.startsWith('avatar_size_'),
                time: 175000,
            });

            sizeChooserCollector.on('collect', async sizeButtonInteraction => {
                const selectedSize = sizeButtonInteraction.customId.split('_')[2];
                const newAvatarURL = `${avatarBaseURL}?size=${selectedSize}`;

                const updatedEmbed = new EmbedBuilder()
                    .setColor(0xFBE7BD)
                    .setTitle(`${displayName || username}'s avatar`)
                    .setImage(newAvatarURL)
                    .setTimestamp();

                await sizeButtonInteraction.update({
                    embeds: [updatedEmbed],
                    components: [sizeButtonsRow1, sizeButtonsRow2]
                });
            });

            sizeChooserCollector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const messageToEdit = await interaction.fetchReply();
                    const currentRows = messageToEdit.components;
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

        showSizesCollector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                const expiredButtonRow = new ActionRowBuilder().addComponents(
                    showSizesButton.setDisabled(true)
                );
                const messageToEdit = await interaction.fetchReply();
                await interaction.editReply({ components: [expiredButtonRow] });
            }
        });
    },
};