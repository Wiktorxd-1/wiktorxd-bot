const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');

function formatTime(seconds) {
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    let out = [];
    if (h > 0) out.push(`${h} hour${h !== 1 ? 's' : ''}`);
    if (m > 0) out.push(`${m} minute${m !== 1 ? 's' : ''}`);
    if (s > 0 || out.length === 0) out.push(`${s} second${s !== 1 ? 's' : ''}`);
    return out.join(' ');
}

const runningUpdates = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('update secrets file')
        .setDefaultMemberPermissions(0)
        .setIntegrationTypes([0])
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to update')
                .setRequired(false)
        )
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to update')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        if (!interaction.guild || interaction.guild.id !== '1369439484659236954') {
            await interaction.editReply('Only allowed in [bubbler discord server](https://discord.gg/4zXsCpqF3m)');
            return;
        }

        const allowed = ['697047593334603837', '743455055193047142'];
        if (!allowed.includes(interaction.user.id)) {
            await interaction.editReply('Nuh uh');
            return;
        }

        const userOption = interaction.options.getUser('user');
        const roleOption = interaction.options.getRole('role');

        if (!userOption && !roleOption) {
            await interaction.editReply('you must choose lil bro');
            return;
        }

        const updateKey = userOption ? `user:${userOption.id}` : `role:${roleOption.id}`;
        if (runningUpdates.has(updateKey)) {
            runningUpdates.get(updateKey).cancelled = true;
            await interaction.editReply('Cancelled successfully');
            return;
        }


        if (userOption && !roleOption) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('update_normal')
                        .setLabel('Normal')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('update_force')
                        .setLabel('Force')
                        .setStyle(ButtonStyle.Success)
                );
            await interaction.editReply({
                content: `What type of update do you want to run for ${userOption.username}`,
                components: [row]
            });

            const buttonInt = await interaction.channel.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 60000
            }).catch(() => null);

            if (!buttonInt) {
                await interaction.editReply({ content: 'No selection made.', components: [] });
                return;
            }

            if (buttonInt.customId === 'update_normal') {
                await buttonInt.update({ content: 'Running normal update...', components: [] });

                await runUpdateForUser(userOption, interaction, null, updateKey);
                return;
            }

            if (buttonInt.customId === 'update_force') {
                const modal = new ModalBuilder()
                    .setCustomId('update_force_modal')
                    .setTitle('Force update username')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('usernames')
                                .setLabel('Enter username(s)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                await buttonInt.showModal(modal);

                const modalInt = await buttonInt.awaitModalSubmit({
                    filter: i => i.user.id === interaction.user.id,
                    time: 120000
                }).catch(() => null);

                if (!modalInt) {
                    await interaction.editReply({ content: 'No usernames given', components: [] });
                    return;
                }

                const usernamesRaw = modalInt.fields.getTextInputValue('usernames');
                const usernames = usernamesRaw.split(',').map(u => u.trim()).filter(u => u.length > 0);

                await modalInt.reply({ content: `Running force update for: ${usernames.join(', ')}` });
                await runUpdateForUser(userOption, interaction, usernames, updateKey);
                return;
            }
            return;
        }

        await runUpdateForRole(roleOption, interaction, updateKey);
    }
};

async function runUpdateForUser(userOption, interaction, forceUsernames, updateKey) {
    const cancelToken = { cancelled: false };
    runningUpdates.set(updateKey, cancelToken);

    try {
        const guild = interaction.guild;
        const ndjsonPath = path.join(__dirname, '../Data/secrets.ndjson');
        const member = await guild.members.fetch(userOption.id).catch(() => null);
        if (!member) {
            await interaction.editReply('User not found.');
            return;
        }
        let robloxUsernames = forceUsernames;
        if (!robloxUsernames) {

            try {
                const url = `https://registry.rover.link/api/guilds/${guild.id}/discord-to-roblox/${member.id}`;
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${process.env.ROVER_API_KEY}` }
                });
                robloxUsernames = response.data?.cachedUsername ? [response.data.cachedUsername] : [];
            } catch {
                robloxUsernames = [];
            }
        }

        if (robloxUsernames.length === 0) {
            await interaction.editReply('No username(s) found for this user');
            return;
        }

        let foundCount = 0;
        const tempPath = ndjsonPath + '.tmp';
        const rl = readline.createInterface({
            input: fs.createReadStream(ndjsonPath),
            crlfDelay: Infinity
        });
        const tempStream = fs.createWriteStream(tempPath);

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                let entryUsername = null;
                const match = entry.hatchedBy?.match(/\(@([a-zA-Z0-9_]+)\)/);
                if (match && match[1]) {
                    entryUsername = match[1];
                } else if (entry.hatchedBy) {
                    entryUsername = entry.hatchedBy.split(' ')[0];
                }
                if (
                    entryUsername &&
                    robloxUsernames.some(u => entryUsername.trim().toLowerCase() === u.toLowerCase())
                ) {
                    foundCount++;
                    entry.discordUserId = member.id;
                    tempStream.write(JSON.stringify(entry) + '\n');
                } else {
                    tempStream.write(line + '\n');
                }
            } catch {
                tempStream.write(line + '\n');
            }
        }
        rl.close();
        tempStream.end();

        await new Promise(resolve => tempStream.on('finish', resolve));
        if (foundCount > 0) {
            fs.renameSync(tempPath, ndjsonPath);
        } else {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
        await interaction.editReply(`Update complete for ${member.user.username}. Updated ${foundCount} entries.`);
    } finally {
        runningUpdates.delete(updateKey);
    }
}

// Helper function for role update (normal)
async function runUpdateForRole(roleOption, interaction, updateKey) {
    const cancelToken = { cancelled: false };
    runningUpdates.set(updateKey, cancelToken);

    try {
        const guild = interaction.guild;
        const ndjsonPath = path.join(__dirname, '../Data/secrets.ndjson');
        const roleMembers = await guild.members.fetch();
        const membersToCheck = roleMembers.filter(m => m.roles.cache.has(roleOption.id)).map(m => m);

        if (membersToCheck.length === 0) {
            await interaction.editReply('No members found for the specified role.');
            return;
        }

        let checkedCount = 0;
        let updatedCount = 0;
        let startTime = Date.now();

        for (const member of membersToCheck) {
            if (cancelToken.cancelled) {
                await interaction.editReply('Updating cancelled');
                break;
            }

            const discordId = member.id;

            if (finishedIds.has(discordId)) {
                checkedCount++;
                continue;
            }

            let robloxUsername = null;
            let finished = false;

            try {
                const url = `https://registry.rover.link/api/guilds/${guild.id}/discord-to-roblox/${discordId}`;
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${process.env.ROVER_API_KEY}` }
                });

                if (response.headers['x-ratelimit-remaining'] === '0') {
                    const waitSec = parseFloat(response.headers['x-ratelimit-reset-after'] || response.headers['retry-after'] || '1');
                    await interaction.editReply(`Rate limited by Rover, waiting ${formatTime(waitSec)}...`);
                    await new Promise(res => setTimeout(res, waitSec * 1000));
                }

                robloxUsername = response.data?.cachedUsername || null;
            } catch (error) {
                if (error.response && error.response.status === 429) {
                    const waitSec = parseFloat(error.response.headers['retry-after'] || '1');
                    await interaction.editReply(`Rate limited by Rover, waiting ${formatTime(waitSec)}...`);
                    await new Promise(res => setTimeout(res, waitSec * 1000));
                    continue;
                }
                checkedData.push({ discordId, username: null, finished: false });
                checkedCount++;
                continue;
            }

            if (!robloxUsername) {
                checkedData.push({ discordId, username: null, finished: true });
                checkedCount++;
                continue;
            }
            let foundCount = 0;
            const tempPath = ndjsonPath + '.tmp';
            const rl = readline.createInterface({
                input: fs.createReadStream(ndjsonPath),
                crlfDelay: Infinity
            });
            const tempStream = fs.createWriteStream(tempPath);

            for await (const line of rl) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line);
                    let entryUsername = null;
                    const match = entry.hatchedBy?.match(/\(@([a-zA-Z0-9_]+)\)/);
                    if (match && match[1]) {
                        entryUsername = match[1];
                    } else if (entry.hatchedBy) {
                        entryUsername = entry.hatchedBy.split(' ')[0];
                    }
                    if (
                        entryUsername &&
                        robloxUsername &&
                        entryUsername.trim().toLowerCase() === robloxUsername.trim().toLowerCase()
                    ) {
                        foundCount++;
                        entry.discordUserId = discordId;
                        tempStream.write(JSON.stringify(entry) + '\n');
                    } else {
                        tempStream.write(line + '\n');
                    }
                } catch {
                    tempStream.write(line + '\n');
                }
            }
            rl.close();
            tempStream.end();

            await new Promise(resolve => tempStream.on('finish', resolve));
            if (foundCount > 0) {
                fs.renameSync(tempPath, ndjsonPath);
                updatedCount++;
            } else {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            }

            finished = true;
            checkedData.push({ discordId, username: robloxUsername, finished });

            checkedCount++;
            avgTime = (Date.now() - startTime) / checkedCount;
            const estTimeLeft = Math.round(avgTime * (total - checkedCount) / 1000);

            fs.writeFileSync(tempCheckedPath, JSON.stringify(checkedData, null, 2));
            await interaction.editReply(
                `Checking people: ${checkedCount}/${total}\nEstimated time left: ${formatTime(estTimeLeft)}`
            );
        }

        if (!cancelToken.cancelled) {
            await interaction.editReply(
                `Update complete, Checked ${checkedCount}/${total} members and updated ${updatedCount} entries in the database`
            );
        }
    } finally {
        runningUpdates.delete(updateKey);
    }
};