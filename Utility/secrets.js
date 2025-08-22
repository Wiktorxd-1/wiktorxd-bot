require('dotenv').config();

const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

function isHatchesEnabled() {
    try {
        const flagsPath = path.join(__dirname, '../flags.txt');
        const lines = fs.readFileSync(flagsPath, 'utf8').split('\n');
        for (const line of lines) {
            const [key, value] = line.split('=');
            if (key && key.trim() === 'hatches') {
                return value && value.trim().toLowerCase() === 'true';
            }
        }
    } catch {}
    return true; 
}

const DATA_DIR = path.resolve(__dirname, '../Data');
const OUTPUT_PATH = path.join(DATA_DIR, 'secrets.ndjson');
const DISABLED_PINGS_PATH = path.join(DATA_DIR, 'disabled_pings.json');
const LAST_ID_PATH = path.join(DATA_DIR, 'last_processed_id.txt');

const SCRAPE_HEADERS = {
    'Authorization': process.env.DISCORD_SCRAPE_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};
const ROVER_API_KEY = process.env.ROVER_API_KEY;

const disabledPings = new Set();
let roverRateLimitUntil = 0;

async function ensureDataDirectoryExists() {
    try {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error(`[Config] FATAL ERROR: Could not create data directory at ${DATA_DIR}:`, error);
        process.exit(1);
    }
}

async function loadDisabledPings() {
    await ensureDataDirectoryExists();
    try {
        const data = await fs.promises.readFile(DISABLED_PINGS_PATH, 'utf8');
        const disabledUsers = JSON.parse(data);
        disabledPings.clear();
        if (Array.isArray(disabledUsers)) {
            disabledUsers.forEach(user => user.id && disabledPings.add(user.id));
        }
    } catch (e) {
        if (e.code !== 'ENOENT') {
            console.error(`[Config] Error reading or parsing ${DISABLED_PINGS_PATH}:`, e);
        }
    }
}

function extractRobloxUsername(hatchedByString) {
    const match = hatchedByString.match(/\(@(.*?)\)/);
    if (match && match[1]) return match[1];
    const firstWordMatch = hatchedByString.match(/^[^(\s@]+/);
    return firstWordMatch ? firstWordMatch[0].replace('@', '') : null;
}

async function getRobloxId(username) {
    try {
        const response = await axios.post(`https://users.roblox.com/v1/usernames/users`, {
            "usernames": [username], "excludeBannedUsers": true
        });
        return response.data?.data?.[0]?.id || null;
    } catch {
        return null;
    }
}

async function getDiscordIdFromRobloxId(robloxId, guildId) {
    while (Date.now() < roverRateLimitUntil) {
        const timeLeft = roverRateLimitUntil - Date.now();
        console.warn(`[RoVer API] Waiting ${Math.ceil(timeLeft / 1000)}s before retrying for Roblox ID: ${robloxId}`);
        await new Promise(r => setTimeout(r, timeLeft + 100));
    }

    if (!guildId) {
        console.warn(`[RoVer API] No guild ID provided for Roblox ID: ${robloxId}. Cannot fetch Discord ID.`);
        return null;
    }

    try {
        const url = `https://registry.rover.link/api/guilds/${guildId}/roblox-to-discord/${robloxId}`;
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${ROVER_API_KEY}` } });

        if (response.headers['x-ratelimit-remaining'] === '0') {
            const waitSec = parseFloat(response.headers['x-ratelimit-reset-after'] || response.headers['retry-after'] || '60');
            roverRateLimitUntil = Date.now() + waitSec * 1000;
            console.warn(`[RoVer API] Rate limited. Pausing requests for ${waitSec}s.`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
        }

        if (response.data && response.data.discordUsers && response.data.discordUsers.length > 0) {
            const discordUser = response.data.discordUsers[0];
            if (discordUser.user && discordUser.user.id) {
                return discordUser.user.id;
            } else {
                console.warn(`[RoVer API] Didnt find discord id`);
                return null;
            }
        } else {

            return null;
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 429) {
                const retryAfter = (error.response.headers['retry-after'] ? parseInt(error.response.headers['retry-after']) : 60) * 1000;
                roverRateLimitUntil = Date.now() + retryAfter;
                console.warn(`[RoVer API] 429 Rate limited. Wait time: ${retryAfter / 1000}s.`);
                await new Promise(r => setTimeout(r, retryAfter));
                return getDiscordIdFromRobloxId(robloxId, guildId);
            } else if (error.response.status === 404) {
                return null;
            } else if (error.response.status === 401 || error.response.status === 403) {
                console.error(`[RoVer API] Authorization error (${error.response.status}) for RoVer API. Check ROVER_API_KEY. Error: ${error.message}`);
            } else {
                console.error(`[RoVer API] Error fetching Discord ID for Roblox ID ${robloxId} (HTTP Status: ${error.response.status}): ${error.response.data?.message || error.message}`);
            }
        } else if (error.request) {
            console.error(`[RoVer API] No response received when fetching Discord ID for Roblox ID ${robloxId}: ${error.message}`);
        } else {
            console.error(`[RoVer API] Request setup error for Roblox ID ${robloxId}: ${error.message}`);
        }
        return null;
    } finally {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

function parseHatchMessage(msg) {
    if (!msg.embeds?.[0]?.title || !msg.embeds?.[0]?.description) return null;
    const embed = msg.embeds[0];
    const desc = embed.description;

    const secret = {
        id: msg.id,
        name: embed.title,
        timestamp: msg.timestamp,
        imageUrl: embed.thumbnail?.url || embed.image?.url || null,
    };

    secret.totalHatched =
        desc.match(/\*\*Total Hatched:\*\* `?([\d,]+)`?/)?.[1] ||
        desc.match(/Total Hatched: `?([\d,]+)`?/)?.[1] ||
        null;

    secret.rarity =
        desc.match(/rarity of hatching this pet is \*\*(.*?)\*\*/)?.[1] ||
        desc.match(/rarity of hatching this pet is (.*?)\n/)?.[1] ||
        null;


    secret.hatchedBy =
        desc.match(/\*\*Hatched by\*\* `([^`]+)`/)?.[1] ||
        desc.match(/Hatched by\*\* ([^\n]+)/)?.[1]?.replace(/`/g, '').trim() ||
        desc.match(/Hatched by:?\s*([^\n]+)/)?.[1]?.replace(/`/g, '').trim() ||
        null;

    return secret;
}

async function appendSecretToFile(secret) {
    await ensureDataDirectoryExists();
    try {
        const minimalSecret = {};
        if (secret.id) minimalSecret.id = secret.id;
        if (secret.name) minimalSecret.name = secret.name;
        if (secret.timestamp) minimalSecret.timestamp = secret.timestamp;
        if (secret.imageUrl) minimalSecret.imageUrl = secret.imageUrl;
        if (secret.totalHatched) minimalSecret.totalHatched = secret.totalHatched;
        if (secret.rarity) minimalSecret.rarity = secret.rarity;
        if (secret.hatchedBy) minimalSecret.hatchedBy = secret.hatchedBy;
        if (typeof secret.discordUserId !== "undefined") {
            minimalSecret.discordUserId = secret.discordUserId;
        }

        const line = JSON.stringify(minimalSecret) + '\n';
        await fs.promises.writeFile(OUTPUT_PATH, line, { flag: 'a' });
    } catch (e) {
        console.error(`[SaveSecret] Error appending to secrets file:`, e);
    }
}

async function updateLastProcessedId(id) {
    try {
        await fs.promises.writeFile(LAST_ID_PATH, id, 'utf8');
    } catch (e) {
        console.error(`[SaveState] Error saving last processed ID:`, e);
    }
}

async function sendHatchEmbed(hatchData, client) {
    const sendingChannel = client.channels.cache.get('1383484997318480013');
    if (!sendingChannel) return;

    let contentMessage = '';
    let addFooter = false;

    if (hatchData.hatchedBy && hatchData.discordUserId && !disabledPings.has(hatchData.discordUserId)) {
        try {
            await sendingChannel.guild.members.fetch(hatchData.discordUserId);
            contentMessage = `<@${hatchData.discordUserId}>`;
            addFooter = true;
        } catch {}
    }

    const unixTimestamp = Math.floor(new Date(hatchData.timestamp).getTime() / 1000);
    const embed = new EmbedBuilder()
        .setTitle(hatchData.name || 'Unknown Pet')
        .setDescription(
            `<:user:1383493798138478732> **Hatched by:** ${hatchData.hatchedBy || 'Unknown'}\n` +
            `<:luck:1383493796876259379> **Exists:** ${hatchData.totalHatched || 'Unknown'}\n` +
            `<:paw:1383493795152265297> **Rarity:** ${hatchData.rarity || 'Unknown'}\n` +
            `<:clock:1383493793772208221> **Time:** <t:${unixTimestamp}:R>`
        )
        .setThumbnail(hatchData.imageUrl)
        .setColor(0xFBE7BD)
        .setTimestamp();

    if (addFooter) {
        embed.setFooter({ text: 'To not get pinged, run /turnoffping in bot commands' });
    }

    try {
        await sendingChannel.send({ content: contentMessage, embeds: [embed] });
    } catch (error) {
        console.error(`[Discord] Failed to send embed for message ${hatchData.id}:`, error);
    }
}

async function scanAndSendHatches(client) {
    let afterId = '895843630881849394'; 
    await ensureDataDirectoryExists();

    try {
        const lastIdFromFile = await fs.promises.readFile(LAST_ID_PATH, 'utf8');
        if (/^\d+$/.test(lastIdFromFile)) {
            afterId = lastIdFromFile.trim();
        }
    } catch (e) {
        if (e.code !== 'ENOENT') console.error(`[Startup] Error reading ${LAST_ID_PATH}:`, e);
        else console.log(`[Startup] ${LAST_ID_PATH} not found. Using default start ID.`);
    }

    console.log(`[Secret] Starting secrets scan after: ${afterId}`);

    while (true) {
        if (!isHatchesEnabled()) {
            break; 
        }

        let fetchedMessages;
        try {
            const url = `https://discord.com/api/v9/channels/791552625866833960/messages?limit=100&after=${afterId}`;
            const response = await axios.get(url, { headers: SCRAPE_HEADERS });
            fetchedMessages = response.data;
        } catch (e) {
            if (e.response?.status === 429) {
                const retryAfter = (e.response.data.retry_after || 1) * 1000;
                console.warn(`[secerts] Rate limited. Waiting ${retryAfter / 1000}s...`);
                await new Promise(r => setTimeout(r, retryAfter));
            } else {
                console.error('[secrets] Error fetching messages:', e.message);
                await new Promise(r => setTimeout(r, 5000));
            }
            continue;
        }

        if (!fetchedMessages || fetchedMessages.length === 0) {
            await new Promise(r => setTimeout(r, 8000));
            continue;
        }

        fetchedMessages.sort((a, b) => BigInt(a.id) > BigInt(b.id) ? 1 : -1);

        let newMessagesProcessed = false;
        for (const msg of fetchedMessages) {
            afterId = msg.id;

            const secret = parseHatchMessage(msg);

            await appendSecretToFile(secret);

            if (secret.hatchedBy) {
                const robloxUsername = extractRobloxUsername(secret.hatchedBy);
                if (robloxUsername) {
                    const robloxId = await getRobloxId(robloxUsername);
                    if (robloxId) {
                        const sendingChannel = client.channels.cache.get('1383484997318480013');
                        const guildId = sendingChannel?.guild.id;
                        if (guildId) {
                            secret.discordUserId = await getDiscordIdFromRobloxId(robloxId, guildId);
                        }
                    }
                }
            }

            await sendHatchEmbed(secret, client);

            await updateLastProcessedId(afterId);
            newMessagesProcessed = true;
        }

        if (!newMessagesProcessed && fetchedMessages.length === 0) {
             await new Promise(r => setTimeout(r, 8000));
        } else {
            await new Promise(r => setTimeout(r, 6000));
        }
    }
}

process.on('uncaughtException', error => {
    console.error('UNCAUGHT EXCEPTION:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED PROMISE REJECTION:', reason, promise);
});

module.exports = async function startSecretsWatcher(discordClient) {
    if (!process.env.DISCORD_SCRAPE_TOKEN || !process.env.ROVER_API_KEY) {
        console.error("[Startup] FATAL: DISCORD_SCRAPE_TOKEN or ROVER_API_KEY is missing from your .env file.");
        process.exit(1);
    }

    await ensureDataDirectoryExists();
    await loadDisabledPings();
    setInterval(loadDisabledPings, 60 * 1000);

    try {
        const sendingChannel = await discordClient.channels.fetch('1383484997318480013', { force: true });
        if (!sendingChannel || !sendingChannel.guild) {
            throw new Error("Could not fetch sending channel or its guild. Ensure channel ID is correct and bot has VIEW_CHANNEL permissions.");
        }
    } catch (e) {
        process.exit(1);
    }

    let scanning = false;

    async function scanLoop() {
        while (true) {
            if (!isHatchesEnabled()) {
                scanning = false;
                await new Promise(res => setTimeout(res, 10000));
                continue;
            }
            if (!scanning) {
                scanning = true;
            }

            await scanAndSendHatches(discordClient);

            await new Promise(res => setTimeout(res, 10000));
        }
    }

    scanLoop();

    setInterval(() => {
        if (!isHatchesEnabled() && scanning) {
            scanning = false;
        }
    }, 30000);
};