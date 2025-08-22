const { EmbedBuilder, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, MessageFlags } = require('discord.js');
const axios = require('axios');
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Get profile informations')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addSubcommand(subcommand =>
            subcommand
                .setName('roblox')
                .setDescription('Lookup a Roblox user\'s profile!')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('Username')
                        .setRequired(true)
                )
        ),
    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'roblox') {
            const username = interaction.options.getString('username');

            const userNotFoundEmbed = new EmbedBuilder()
                .setColor(0xFBE7BD)
                .setTitle(`User "${username}" not found.`)
                .setTimestamp();

            await interaction.deferReply({ flags: 0 });

            let targetUserId;
            let targetUsername;
            let targetAvatarUrl = null;
            let creationDateTimestamp = 'N/A';

            const makeRobloxRequest = async (url, config = {}, retries = 3, delaySeconds = 5) => {
                for (let i = 0; i < retries; i++) {
                    try {
                        const response = await axios.get(url, config);
                        return response;
                    } catch (error) {
                        if (error.response && error.response.status === 429) {
                            const retryAfter = parseInt(error.response.headers['retry-after']) || delaySeconds;
                            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                        } else {
                            throw error;
                        }
                    }
                }
                throw new Error(`Failed to fetch ${url} after ${retries} retries due to persistent issues.`);
            };

            const makeRoverRequest = async (url, retries = 3, delaySeconds = 5) => {
                const roverApiKey = process.env.ROVER_API_KEY;
                if (!roverApiKey) {
                    throw new Error('ROVER_API_KEY is not set in environment variables.');
                }
                for (let i = 0; i < retries; i++) {
                    try {
                        const response = await axios.get(url, {
                            headers: {
                                'Authorization': `Bearer ${roverApiKey}`,
                                'Accept': 'application/json'
                            }
                        });
                        return response;
                    } catch (error) {
                        if (error.response && error.response.status === 429) {
                            const retryAfter = (error.response.data?.retry_after || 60) * 1000;
                            console.warn(`[RoVer API] Rate limited. Pausing requests for ${retryAfter / 1000}s.`);
                            await new Promise(resolve => setTimeout(resolve, retryAfter));
                        } else {
                            throw error;
                        }
                    }
                }
                throw new Error(`Failed to fetch ${url} from Rover after ${retries} retries.`);
            };

            try {
                const userResponse = await axios.post(`https://users.roblox.com/v1/usernames/users`, {
                    usernames: [username],
                    excludeBannedUsers: true
                });

                if (userResponse.data && userResponse.data.data && userResponse.data.data.length > 0) {
                    targetUserId = userResponse.data.data[0].id;
                    targetUsername = userResponse.data.data[0].name;
                } else {
                    return interaction.editReply({ embeds: [userNotFoundEmbed] });
                }

                let followersCount = 'N/A';
                let followingCount = 'N/A';
                let profileDescription = 'No description provided.';

                try {
                    const profileInfoResponse = await makeRobloxRequest(`https://users.roblox.com/v1/users/${targetUserId}`);
                    if (profileInfoResponse.data) {
                        const creationDate = new Date(profileInfoResponse.data.created);
                        creationDateTimestamp = `<t:${Math.floor(creationDate.getTime() / 1000)}:R>`;
                        profileDescription = profileInfoResponse.data.description || 'No description provided.';
                    }
                } catch (error) {
                    console.error(`Error fetching general profile info for ${targetUsername}:`, error.message);
                }

                try {
                    const avatarResponse = await makeRobloxRequest(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${targetUserId}&size=420x420&format=Png&isCircular=false`);
                    if (avatarResponse.data && avatarResponse.data.data && avatarResponse.data.data.length > 0) {
                        targetAvatarUrl = avatarResponse.data.data[0].imageUrl;
                    }
                } catch (error) {
                    console.error(`Error fetching avatar for ${targetUsername}:`, error.message);
                }

                try {
                    const followersResponse = await makeRobloxRequest(`https://friends.roblox.com/v1/users/${targetUserId}/followers/count`);
                    if (followersResponse.data && typeof followersResponse.data.count === 'number') {
                        followersCount = followersResponse.data.count;
                    }
                } catch (error) {
                    console.error(`Error fetching followers count for ${targetUsername}:`, error.message);
                }

                try {
                    const followingResponse = await makeRobloxRequest(`https://friends.roblox.com/v1/users/${targetUserId}/followings/count`);
                    if (followingResponse.data && typeof followingResponse.data.count === 'number') {
                        followingCount = followingResponse.data.count;
                    }
                } catch (error) {
                    console.error(`Error fetching following count for ${targetUsername}:`, error.message);
                }

                let allFriends = [];
                let friendCount = 0;
                let friendsCursor = null;
                for (let i = 0; i < 4; i++) {
                    try {
                        const friendsResponse = await makeRobloxRequest(`https://friends.roblox.com/v1/users/${targetUserId}/friends`, {
                            params: {
                                limit: 50,
                                cursor: friendsCursor
                            }
                        });

                        if (friendsResponse.data && friendsResponse.data.data) {
                            allFriends = allFriends.concat(friendsResponse.data.data);
                            friendsCursor = friendsResponse.data.nextPageCursor;
                            if (!friendsCursor) break;
                        } else {
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error) {
                        console.error(`Error fetching friends page ${i + 1} for ${targetUsername}:`, error.message);
                        break;
                    }
                }
                friendCount = allFriends.length;

                let userGroups = [];
                let groupCount = 0;
                try {
                    const groupsResponse = await makeRobloxRequest(`https://groups.roblox.com/v1/users/${targetUserId}/groups/roles`);
                    if (groupsResponse.data && groupsResponse.data.data) {
                        userGroups = groupsResponse.data.data;
                        groupCount = userGroups.length;
                    }
                } catch (error) {
                    console.error(`Error fetching groups for ${targetUsername}:`, error.message);
                }

                let discordUserInfo = 'Cannot check in this server/DM, must be in [bubbler discord server](https://discord.gg/4zXsCpqF3m)';
                const guildId = interaction.guild?.id;

                if (guildId) {
                    try {
                        const roverResponse = await makeRoverRequest(`https://registry.rover.link/api/guilds/${guildId}/roblox-to-discord/${targetUserId}`);
                        if (roverResponse.data && roverResponse.data.discordUsers && roverResponse.data.discordUsers.length > 0) {
                            const linkedUsers = roverResponse.data.discordUsers.map(du => `<@${du.user.id}> (${du.user.username}${du.user.discriminator === '0' ? '' : `#${du.user.discriminator}`})`).join('\n');
                            discordUserInfo = linkedUsers.substring(0, 1024);
                        } else {
                            discordUserInfo = 'Not linked in this server';
                        }
                    } catch (error) {
                        console.error(`Error fetching Discord info from Rover for ${targetUsername} in guild ${guildId}:`, error.message);
                        if (error.response && error.response.data && error.response.data.errorCode) {
                            if (error.response.data.errorCode === 'user_not_found') {
                                discordUserInfo = 'not found';
                            } else if (error.response.status === 429) {
                                discordUserInfo = 'rate limited';
                            } else {
                                discordUserInfo = 'Error fetching from Rover';
                            }
                        } else if (error.response && error.response.status === 429) {
                            discordUserInfo = 'rate limited';
                        } else {
                            discordUserInfo = 'Error fetching from Rover';
                        }
                    }
                }

                const mainEmbed = new EmbedBuilder()
                    .setColor(0xFBE7BD)
                    .setTitle(targetUsername)
                    .setURL(`https://www.roblox.com/users/${targetUserId}/profile`)
                    .setThumbnail(targetAvatarUrl)
                    .addFields(
                        { name: 'Roblox ID:', value: String(targetUserId), inline: true },
                        { name: 'Joined Date:', value: creationDateTimestamp, inline: true },
                        { name: 'Friends:', value: String(friendCount), inline: true },
                        { name: 'Followers:', value: String(followersCount), inline: true },
                        { name: 'Following:', value: String(followingCount), inline: true },
                        { name: 'Groups:', value: String(groupCount), inline: true },
                        { name: 'Description:', value: profileDescription.substring(0, 1024) || 'None found.', inline: false },
                        { name: 'Discord:', value: discordUserInfo, inline: false }
                    )
                    .setTimestamp();

                const actionRowComponents = [];

                if (allFriends.length > 0) {
                    actionRowComponents.push(
                        new ButtonBuilder()
                            .setCustomId('show_friends')
                            .setLabel('Show Friends')
                            .setStyle(ButtonStyle.Primary)
                    );
                }
                if (userGroups.length > 0) {
                    actionRowComponents.push(
                        new ButtonBuilder()
                            .setCustomId('show_groups')
                            .setLabel('Show Groups')
                            .setStyle(ButtonStyle.Primary)
                    );
                }

                actionRowComponents.push(
                    new ButtonBuilder()
                        .setCustomId('show_avatar')
                        .setLabel('Show Avatar')
                        .setStyle(ButtonStyle.Primary)
                );

                const components =
                    actionRowComponents.length > 0 && interaction.guild
                        ? [new ActionRowBuilder().addComponents(actionRowComponents)]
                        : [];

                await interaction.editReply({
                    embeds: [mainEmbed],
                    components: components
                });


                if (components.length > 0 && interaction.guild && interaction.channel) {
                    const initialButtonFilter = i => (
                        i.customId === 'show_friends' ||
                        i.customId === 'show_groups' ||
                        i.customId === 'show_avatar'
                    ) && i.user.id === interaction.user.id;

                    const initialButtonCollector = interaction.channel.createMessageComponentCollector({
                        filter: initialButtonFilter,
                        componentType: ComponentType.Button,
                        time: 180000
                    });

                    initialButtonCollector.on('collect', async i => {
                        await i.deferUpdate();

                        if (i.customId === 'show_friends') {
                            const friendsPages = [];
                            const friendsPerPage = 25;

                            for (let j = 0; j < allFriends.length; j += friendsPerPage) {
                                const pageFriends = allFriends.slice(j, j + friendsPerPage);
                                const embed = new EmbedBuilder()
                                    .setColor(0xFBE7BD)
                                    .setTitle(`${targetUsername}'s Friends (Page ${friendsPages.length + 1}/${Math.ceil(allFriends.length / friendsPerPage)})`)
                                    .setDescription(`Total Friends: ${allFriends.length}`)
                                    .setTimestamp();

                                for (const friend of pageFriends) {
                                    embed.addFields({ name: friend.name, value: `[Profile](https://www.roblox.com/users/${friend.id}/profile)`, inline: true });
                                }
                                friendsPages.push(embed);
                            }

                            let currentFriendPage = 0;

                            const getFriendsPaginationRow = (pageIndex) => {
                                return new ActionRowBuilder()
                                    .addComponents(
                                        new ButtonBuilder()
                                            .setCustomId('prev_friend_page')
                                            .setLabel('Previous')
                                            .setStyle(ButtonStyle.Primary)
                                            .setDisabled(pageIndex === 0),
                                        new ButtonBuilder()
                                            .setCustomId('next_friend_page')
                                            .setLabel('Next')
                                            .setStyle(ButtonStyle.Primary)
                                            .setDisabled(pageIndex === friendsPages.length - 1 || friendsPages.length === 0),
                                        new ButtonBuilder()
                                            .setCustomId('delete_friends_message')
                                            .setLabel('Delete')
                                            .setEmoji('🗑️')
                                            .setStyle(ButtonStyle.Danger)
                                    );
                            };

                            try {
                                const followUpMessage = await i.followUp({
                                    embeds: [friendsPages[currentFriendPage]],
                                    components: [getFriendsPaginationRow(currentFriendPage)],
                                    flags: 0
                                });

                                const paginationFilter = (btnInteraction) => btnInteraction.user.id === interaction.user.id;
                                const paginationCollector = followUpMessage.createMessageComponentCollector({
                                    filter: paginationFilter,
                                    componentType: ComponentType.Button,
                                    time: 180000
                                });

                                paginationCollector.on('collect', async btnI => {
                                    await btnI.deferUpdate();

                                    if (btnI.customId === 'prev_friend_page') {
                                        currentFriendPage--;
                                    } else if (btnI.customId === 'next_friend_page') {
                                        currentFriendPage++;
                                    } else if (btnI.customId === 'delete_friends_message') {
                                        await followUpMessage.delete().catch(e => console.error('Failed to delete friends message:', e));
                                        paginationCollector.stop('deleted');
                                        return;
                                    }

                                    try {
                                        await btnI.editReply({
                                            embeds: [friendsPages[currentFriendPage]],
                                            components: [getFriendsPaginationRow(currentFriendPage)]
                                        });
                                    } catch (updateError) {
                                        console.error(`[Button Error] Failed to update friends page for user ${interaction.user.id}:`, updateError.message);
                                        try {
                                            await btnI.followUp({ content: 'Failed to update friends list. The interaction may have expired or an internal error occurred. Please try the /profile command again.', flags: MessageFlags.Ephemeral });
                                        } catch (e) { console.error('Failed to send error follow-up after pagination update error:', e); }
                                    }
                                });

                                paginationCollector.on('end', async (collected, reason) => {
                                    if (reason === 'deleted') return;
                                    const disabledRow = getFriendsPaginationRow(currentFriendPage);
                                    disabledRow.components.forEach(button => button.setDisabled(true));
                                    try {
                                        if (followUpMessage) {
                                            await followUpMessage.edit({ components: [disabledRow] }).catch(e => console.error('Failed to disable friends buttons:', e));
                                        }
                                    } catch (e) {
                                        console.error('Error disabling friends buttons on collector end:', e);
                                    }
                                });
                            } catch (error) {
                                console.error(`[Button Error] Failed to send initial friends list for user ${interaction.user.id}:`, error.message);
                                try {
                                    await i.followUp({
                                        content: 'Failed to show friends list. An internal error occurred.',
                                        flags: MessageFlags.Ephemeral
                                    });
                                } catch (e) { console.error('Failed to send error follow-up for initial friends list:', e); }
                            }

                        } else if (i.customId === 'show_groups') {
                            const groupsPages = [];
                            const groupsPerPage = 25;
                            const totalGroupPages = Math.ceil(userGroups.length / groupsPerPage);

                            for (let j = 0; j < totalGroupPages; j++) {
                                const start = j * groupsPerPage;
                                const end = start + groupsPerPage;
                                const pageGroups = userGroups.slice(start, end);

                                const embed = new EmbedBuilder()
                                    .setColor(0xFBE7BD)
                                    .setTitle(`${targetUsername}'s Groups (Page ${j + 1}/${totalGroupPages})`)
                                    .setDescription(`Total Groups: ${userGroups.length}`)
                                    .setTimestamp();

                                for (const group of pageGroups) {
                                    embed.addFields({ name: group.group.name, value: `ID: ${group.group.id}\nRank: ${group.role.name}`, inline: true });
                                }
                                groupsPages.push(embed);
                            }

                            let currentGroupPage = 0;

                            const getGroupsPaginationRow = (pageIndex) => {
                                return new ActionRowBuilder()
                                    .addComponents(
                                        new ButtonBuilder()
                                            .setCustomId('prev_group_page')
                                            .setLabel('Previous')
                                            .setStyle(ButtonStyle.Primary)
                                            .setDisabled(pageIndex === 0),
                                        new ButtonBuilder()
                                            .setCustomId('next_group_page')
                                            .setLabel('Next')
                                            .setStyle(ButtonStyle.Primary)
                                            .setDisabled(pageIndex === groupsPages.length - 1 || groupsPages.length === 0),
                                        new ButtonBuilder()
                                            .setCustomId('delete_groups_message')
                                            .setLabel('Delete')
                                            .setEmoji('🗑️')
                                            .setStyle(ButtonStyle.Danger)
                                    );
                            };

                            try {
                                const followUpMessage = await i.followUp({
                                    embeds: [groupsPages[currentGroupPage]],
                                    components: [getGroupsPaginationRow(currentGroupPage)],
                                    flags: 0
                                });

                                const paginationFilter = (btnInteraction) => btnInteraction.user.id === interaction.user.id;
                                const paginationCollector = followUpMessage.createMessageComponentCollector({
                                    filter: paginationFilter,
                                    componentType: ComponentType.Button,
                                    time: 180000
                                });

                                paginationCollector.on('collect', async btnI => {
                                    await btnI.deferUpdate();

                                    if (btnI.customId === 'prev_group_page') {
                                        currentGroupPage--;
                                    } else if (btnI.customId === 'next_group_page') {
                                        currentGroupPage++;
                                    } else if (btnI.customId === 'delete_groups_message') {
                                        await followUpMessage.delete().catch(e => console.error('Failed to delete groups message:', e));
                                        paginationCollector.stop('deleted');
                                        return;
                                    }

                                    try {
                                        await btnI.editReply({
                                            embeds: [groupsPages[currentGroupPage]],
                                            components: [getGroupsPaginationRow(currentGroupPage)]
                                        });
                                    } catch (updateError) {
                                        console.error(`[Button Error] Failed to update groups page for user ${interaction.user.id}:`, updateError.message);
                                        try {
                                            await btnI.followUp({ content: 'Something broke, time to kms', flags: MessageFlags.Ephemeral });
                                        } catch (e) { console.error('Failed to send error follow-up after pagination update error:', e); }
                                    }
                                });

                                paginationCollector.on('end', async (collected, reason) => {
                                    if (reason === 'deleted') return;
                                    const disabledRow = getGroupsPaginationRow(currentGroupPage);
                                    disabledRow.components.forEach(button => button.setDisabled(true));
                                    try {
                                        if (followUpMessage) {
                                            await followUpMessage.edit({ components: [disabledRow] }).catch(e => console.error('Failed to disable groups buttons:', e));
                                        }
                                    } catch (e) {
                                        console.error('Error disabling groups buttons on collector end:', e);
                                    }
                                });
                            } catch (error) {
                                console.error(`[Button Error] Failed to send initial groups list for user ${interaction.user.id}:`, error.message);
                                try {
                                    await i.followUp({
                                        content: 'error loading groups',
                                        flags: MessageFlags.Ephemeral
                                    });
                                } catch (e) { console.error('Failed to send error follow-up for initial groups list:', e); }
                            }
                        } else if (i.customId === 'show_avatar') {

                            let fullAvatarUrl = null;
                            try {
                                const avatarResponse = await axios.get(
                                    `https://thumbnails.roblox.com/v1/users/avatar?userIds=${targetUserId}&size=720x720&format=Png&isCircular=false`
                                );
                                if (
                                    avatarResponse.data &&
                                    avatarResponse.data.data &&
                                    avatarResponse.data.data.length > 0
                                ) {
                                    fullAvatarUrl = avatarResponse.data.data[0].imageUrl;
                                }
                            } catch (error) {
                                fullAvatarUrl = null;
                            }

                            if (fullAvatarUrl) {
                                await i.followUp({
                                    embeds: [
                                        new EmbedBuilder()
                                            .setColor(0xFBE7BD)
                                            .setTitle(`${targetUsername}'s Full Avatar`)
                                            .setImage(fullAvatarUrl)
                                            .setURL(`https://www.roblox.com/users/${targetUserId}/profile`)
                                            .setTimestamp()
                                    ]
                                });
                            } else {
                                await i.followUp({
                                    content: 'Could not fetch full avatar image.'
                                });
                            }
                        }
                    });

                    initialButtonCollector.on('end', async (collected, reason) => {
                        if (reason === 'time' || reason === 'idle') {
                            const originalReply = await interaction.fetchReply().catch(() => null);
                            if (originalReply && !(originalReply.flags && originalReply.flags.has && originalReply.flags.has(MessageFlags.Ephemeral))) {
                                const disabledComponents = components.map(row => {
                                    const newRow = ActionRowBuilder.from(row);
                                    newRow.components.forEach(button => button.setDisabled(true));
                                    return newRow;
                                });
                                await originalReply.edit({ components: disabledComponents }).catch(() => {});
                            }
                        }
                    });
                }

            } catch (error) {
                console.error('Fatal error during profile lookup (main block):', error);

                try {
                    await interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xFBE7BD)
                                .setTitle('Rate limit/Api down')
                                .setDescription('Not bot\'s fault, alr?')
                                .setTimestamp()
                        ],
                        components: []
                    });
                } catch (e) {
                    console.error('Failed to edit initial reply with error message (main block):', e);
                    try {
                        await interaction.followUp({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0xFBE7BD)
                                    .setTitle('Error')
                                    .setDescription('Unknown error, will be fixed! (When, idgaf)')
                                    .setTimestamp()
                            ],
                            flags: MessageFlags.Ephemeral
                        });
                    } catch (followUpError) {
                        console.error('Failed to send even a follow-up error message (main block):', followUpError);
                    }
                }
            }
        } else {
            await interaction.reply({ content: 'Wait what the fuck how', flags: MessageFlags.Ephemeral });
        }
    },
};